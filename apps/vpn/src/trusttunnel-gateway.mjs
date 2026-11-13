/**
 * Experimental TCP-only IPv4 -> IPv6 TLS passthrough for TrustTunnel testing.
 * The upstream is fixed and caller data is never used to select a destination.
 * This is not an authentication, VPN, UDP, quota or production deployment
 * mechanism. Public IPv4 ingress is an explicit opt-in and remains subject to
 * global/per-source connection and token-bucket limits.
 */
import net from 'node:net';
import { pathToFileURL } from 'node:url';

function numberInRange(value, min, max, name) {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) throw new Error(`Invalid ${name}`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error(`Invalid ${name}`);
  return result;
}

const mappedIpv4 = new net.BlockList();
mappedIpv4.addSubnet('::ffff:0:0', 96, 'ipv6');

export function parseGatewayConfig(env) {
  const bindHost = env.TRIOZ_TT_GATEWAY_BIND || '127.0.0.1';
  const targetHost = env.TRIOZ_TT_GATEWAY_TARGET_IPV6 || '';
  const bindPort = numberInRange(env.TRIOZ_TT_GATEWAY_PORT || '', 1, 65535, 'listen port');
  const targetPort = numberInRange(env.TRIOZ_TT_GATEWAY_TARGET_PORT || '', 1, 65535, 'target port');
  const maxConnections = numberInRange(env.TRIOZ_TT_GATEWAY_MAX_CONNECTIONS || '32', 1, 256, 'connection limit');
  const maxConnectionsPerSource = numberInRange(env.TRIOZ_TT_GATEWAY_MAX_PER_SOURCE || '16', 1, 256, 'per-source connection limit');
  const sourceRatePerMinute = numberInRange(env.TRIOZ_TT_GATEWAY_SOURCE_RATE_PER_MINUTE || '60', 1, 3600, 'per-source rate');
  const sourceBurst = numberInRange(env.TRIOZ_TT_GATEWAY_SOURCE_BURST || '20', 1, 256, 'per-source burst');
  const maxTrackedSources = numberInRange(env.TRIOZ_TT_GATEWAY_MAX_TRACKED_SOURCES || '4096', 16, 65536, 'tracked-source limit');
  const idleMs = numberInRange(env.TRIOZ_TT_GATEWAY_IDLE_MS || '60000', 1000, 600000, 'idle timeout');
  const connectTimeoutMs = numberInRange(env.TRIOZ_TT_GATEWAY_CONNECT_MS || '5000', 100, 30000, 'connect timeout');
  const allowAnyIpv4 = env.TRIOZ_TT_GATEWAY_ALLOW_ANY_IPV4 === 'true';
  const rawSources = (env.TRIOZ_TT_GATEWAY_ALLOWED_IPV4 || '').trim();
  const sources = rawSources ? rawSources.split(',').map(s => s.trim()) : [];
  if (net.isIP(bindHost) !== 4 || bindHost === '0.0.0.0') throw new Error('Invalid listen address');
  if (net.isIP(targetHost) !== 6 || targetHost.includes('%') || mappedIpv4.check(targetHost, 'ipv6')) throw new Error('Invalid IPv6 target');
  if (sources.length > 128 || sources.some(s => net.isIP(s) !== 4 || s === '0.0.0.0')) throw new Error('Invalid IPv4 source allowlist');
  if (allowAnyIpv4 && sources.length) throw new Error('Public IPv4 mode cannot be combined with a source allowlist');
  if (!allowAnyIpv4 && !sources.length) throw new Error('An IPv4 source allowlist or explicit public mode is required');
  return {
    bindHost,
    bindPort,
    targetHost,
    targetPort,
    allowed: new Set(sources),
    allowAnyIpv4,
    maxConnections,
    maxConnectionsPerSource,
    sourceRatePerMinute,
    sourceBurst,
    maxTrackedSources,
    idleMs,
    connectTimeoutMs,
  };
}

/**
 * The listener never interprets data, headers or credentials. node streams
 * provide backpressure; half-close is preserved. No peer data is logged.
 * Stop accepting with close(); destroyAll() terminates existing connections.
 */
export function createGateway(config) {
  let active = 0;
  const sockets = new Set();
  const sourceStates = new Map();
  const sourceStateTtlMs = Math.max(config.idleMs, 120000);

  function sourceStateFor(address, now) {
    let state = sourceStates.get(address);
    if (!state) {
      if (sourceStates.size >= config.maxTrackedSources) {
        for (const [ip, tracked] of sourceStates) {
          if (tracked.active === 0 && now - tracked.lastSeenAt >= sourceStateTtlMs) {
            sourceStates.delete(ip);
          }
        }
      }
      if (sourceStates.size >= config.maxTrackedSources) return null;
      state = {
        active: 0,
        tokens: config.sourceBurst,
        updatedAt: now,
        lastSeenAt: now,
      };
      sourceStates.set(address, state);
    }

    const elapsed = Math.max(0, now - state.updatedAt);
    state.tokens = Math.min(
      config.sourceBurst,
      state.tokens + (elapsed * config.sourceRatePerMinute) / 60000,
    );
    state.updatedAt = now;
    state.lastSeenAt = now;
    if (state.active >= config.maxConnectionsPerSource || state.tokens < 1) return null;
    state.tokens -= 1;
    state.active += 1;
    return state;
  }

  const server = net.createServer({ allowHalfOpen: true, pauseOnConnect: true }, client => {
    // Denied sockets can still emit asynchronous errors.
    client.on('error', () => {});
    const sourceAddress = client.remoteAddress;
    if (
      net.isIP(sourceAddress) !== 4 ||
      (!config.allowAnyIpv4 && !config.allowed.has(sourceAddress)) ||
      active >= config.maxConnections
    ) {
      client.destroy();
      return;
    }
    const sourceState = sourceStateFor(sourceAddress, Date.now());
    if (!sourceState) {
      client.destroy();
      return;
    }
    active++;
    let closed = false;
    let upstream;
    const finish = () => {
      if (closed) return;
      closed = true;
      active--;
      sourceState.active--;
      sourceState.lastSeenAt = Date.now();
      sockets.delete(client);
      if (upstream) sockets.delete(upstream);
      client.destroy();
      if (upstream) upstream.destroy();
    };
    sockets.add(client);
    client.on('error', finish);
    client.on('close', finish);
    client.setTimeout(config.idleMs, finish);
    try {
      upstream = net.createConnection({ host: config.targetHost, port: config.targetPort, family: 6, allowHalfOpen: true });
      sockets.add(upstream);
      upstream.on('error', finish);
      upstream.on('close', finish);
      upstream.setTimeout(config.connectTimeoutMs, finish);
      upstream.once('connect', () => {
        if (closed) return;
        upstream.setTimeout(config.idleMs, finish);
        client.pipe(upstream);
        upstream.pipe(client);
        client.resume();
      });
    } catch {
      finish();
    }
  });
  return {
    server,
    active: () => active,
    destroyAll: () => { for (const socket of sockets) socket.destroy(); },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = parseGatewayConfig(process.env);
    const gateway = createGateway(config);
    gateway.server.on('error', () => {
      console.error('Gateway listener failed');
      process.exitCode = 1;
    });
    gateway.server.listen(config.bindPort, config.bindHost, () => console.log('TCP gateway listening'));
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      gateway.server.close();
      gateway.destroyAll();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch {
    console.error('Invalid gateway configuration');
    process.exitCode = 1;
  }
}
