import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const code = esbuild.transformSync(readFileSync(resolve(import.meta.dirname, '../apps/desktop/src/main/vpn.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
function setup() {
  const counts = { up: 0, down: 0, route: 0, physical: 0, sent: [] };
  const mod = { exports: {} };
  const fakeRun = async (file) => ({ stdout: file === 'sc.exe' ? 'STATE: RUNNING' : 'Up', stderr: '' });
  const fs = {
    existsSync: (path) => String(path).endsWith('amneziawg.exe'),
    mkdirSync() {}, chmodSync() {}, writeFileSync() {}, rmSync() {},
    readFileSync() { throw new Error('no owned route'); },
  };
  const imports = {
    electron: { app: { isPackaged: true, getPath: () => '/user', getAppPath: () => '/app' } },
    './mainWindow': { getMainWindow: () => ({ webContents: { send: (...args) => counts.sent.push(args) } }) },
    './foreignVpn': { detectForeignTunnels: async () => [], foreignTunnelMessage: () => '' },
    './winTunnel': {
      windowsLinkVerdict: async () => 'fresh', windowsTunnelExists: async () => false,
      windowsTunnelUp: async () => { counts.up++; return 'C:/TrioZ/amneziawg.exe'; },
      windowsTunnelDown: async () => { counts.down++; },
    },
    './vpnLifecycle': { vpnNeedsCleanup: (s, physical) => s === 'on' || s === 'connecting' || physical,
      cleanupAfterFailedStart: async (fn) => { try { await fn(); } catch {} } },
    './networkHandoff': { NetworkHandoff: class { setBaseline() {} async cancel() {} async scan() {} } },
    './winNetwork': {
      physicalRoute: async () => { counts.physical++; return null; }, gatewayReady: async () => false,
      gatewayPing: async () => false, endpointRoutes: async () => [], resolveEndpoint: async () => { throw new Error('DNS unavailable'); },
      changeEndpointRoute: async () => { counts.route++; throw new Error('UAC denied'); },
      recentAwgHandshake: async () => false,
    },
    '../shared/constants': { IPC: { VPN_STATE: 'vpn:state' } },
    '../shared/vpnPlan': { TUNNEL_CONF_FILE: 'trioz.conf', TUNNEL_NAME: 'trioz',
      tunnelBackendCandidates: () => [{ exe: 'amneziawg.exe', backend: 'amneziawg' }],
      HANDSHAKE_FRESH_SECONDS: 180 },
    '../shared/vpnEmbedded': { EMBEDDED_DIR: 'wireguard', embeddedClientName: () => 'amneziawg.exe',
      parseWgConfig: () => ({ privateKey: 'key', addresses: ['10.0.0.2'], peers: [{ endpoint: 'vpn.example:51820' }] }) },
    '../shared/tunnelService': { serviceDir: () => '', serviceRequestDir: () => '', AGENT_FILE: '', STATUS_FILE: '', TUNNEL_FILE: '' },
  };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, console,
    process: { platform: 'win32', env: {}, resourcesPath: 'C:/resources', execPath: 'C:/app.exe' },
    __dirname: '/app/dist', Buffer, setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {},
    require: (name) => name === 'node:util' ? { promisify: () => fakeRun } : name === 'node:fs' ? fs : imports[name] ?? require(name),
  });
  return { api: mod.exports, counts };
}
test('initial AmneziaWG startup remains available without gateway ping, DNS or manual /32', async () => {
  const t = setup();
  const state = await t.api.vpnUp('[Interface]\nPrivateKey = abc\n[Peer]\nEndpoint = vpn.example:51820');
  assert.equal(t.counts.up, 1); assert.equal(t.counts.route, 0);
  assert.equal(state.state, 'connecting');
});
test('handshake log parser unavailable does not veto original healthy connection', async () => {
  const t = setup();
  await t.api.vpnUp('[Interface]\nPrivateKey = abc\n[Peer]\nEndpoint = vpn.example:51820');
  await new Promise((r) => setImmediate(r));
  assert.equal(t.api.vpnState().state, 'on');
  assert.equal(t.counts.route, 0);
});
