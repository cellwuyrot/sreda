import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const code = esbuild.transformSync(readFileSync(resolve(import.meta.dirname, '../apps/desktop/src/main/winNetwork.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
const physical = { interfaceIndex: 17, interfaceAlias: 'Wi-Fi', localAddress: '192.168.42.10', gateway: '192.168.42.129', dnsServers: ['192.168.42.129'] };
function setup() {
  const calls = [];
  let answer = '';
  const fakeRun = async (file, args) => {
    calls.push({ file, args });
    return { stdout: typeof answer === 'function' ? answer(file, args) : answer, stderr: '' };
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) =>
    name === 'node:util' ? { promisify: () => fakeRun } : require(name), Buffer, Date, console });
  return { api: module.exports, calls, answer: (x) => { answer = x; } };
}
function encodedScript(call) {
  const cmd = call.args.at(-1);
  const encoded = call.args.includes('-EncodedCommand') ? cmd : cmd.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)?.[1];
  return Buffer.from(encoded, 'base64').toString('utf16le');
}
test('old owned endpoint /32 removed by exact IP, interface and gateway', async () => {
  const t = setup(); await t.api.changeEndpointRoute({ ip: '203.0.113.10', interfaceIndex: 12, gateway: '192.168.1.1' }, null);
  const script = encodedScript(t.calls[0]);
  assert.match(script, /Remove-NetRoute/); assert.match(script, /203\.0\.113\.10\/32/);
  assert.match(script, /InterfaceIndex 12/); assert.match(script, /192\.168\.1\.1/);
  assert.doesNotMatch(script, /New-NetRoute/);
});
test('new endpoint /32 uses current hotspot index and next hop; verifies Get-NetRoute', async () => {
  const t = setup(); t.answer('192.168.42.129');
  await t.api.changeEndpointRoute(null, { ip: '203.0.113.11', interfaceIndex: 17, gateway: '192.168.42.129' });
  const script = encodedScript(t.calls[0]);
  assert.match(script, /New-NetRoute/); assert.match(script, /0\.0\.0\.0\/0.*InterfaceIndex 17/);
  assert.match(script, /203\.0\.113\.11\/32/); assert.match(script, /NextHop '192\.168\.42\.129'/);
  assert.equal(t.calls.length, 2);
});
test('no verified endpoint route fails closed', async () => {
  const t = setup(); t.answer('');
  await assert.rejects(t.api.changeEndpointRoute(null, { ip: '203.0.113.11', interfaceIndex: 17, gateway: '192.168.42.129' }), /verification failed/);
});
test('invalid endpoint route never reaches a shell', async () => {
  const t = setup(); await assert.rejects(t.api.changeEndpointRoute(null, { ip: 'bad;cmd', interfaceIndex: 17, gateway: '192.168.42.129' }));
  assert.equal(t.calls.length, 0);
});
test('hostname resolves via physical DNS, not VPN DNS', async () => {
  const t = setup(); t.answer('203.0.113.11');
  assert.equal(await t.api.resolveEndpoint('vpn.example.com:51820', physical), '203.0.113.11');
  assert.match(encodedScript(t.calls[0]), /-Server '192\.168\.42\.129'/);
});
test('IPv4 endpoint works without DNS; IPv6 explicitly fails closed', async () => {
  const t = setup(); assert.equal(await t.api.resolveEndpoint('203.0.113.11:51820', physical), '203.0.113.11');
  await assert.rejects(t.api.resolveEndpoint('[2001:db8::1]:51820', physical), /IPv6/);
  assert.equal(t.calls.length, 0);
});
test('AmneziaWG /dumplog requires recent trioz handshake, not another tunnel', async () => {
  const t = setup(); const stamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
  t.answer(`${stamp} [TUN] [other] Received handshake response\n${stamp} [TUN] [trioz] Received handshake response`);
  assert.equal(await t.api.recentAwgHandshake('amneziawg.exe', Date.now() - 1000), true);
  assert.equal(t.calls[0].args[0], '/dumplog');
  assert.equal(await t.api.recentAwgHandshake('amneziawg.exe', Date.now() + 10000), false);
});
test('stale or absent handshake never turns into VPN on', async () => {
  const t = setup(); t.answer('2020-01-01 00:00:00 [TUN] [trioz] Received handshake response');
  assert.equal(await t.api.recentAwgHandshake('amneziawg.exe'), false);
  t.answer(''); assert.equal(await t.api.recentAwgHandshake('amneziawg.exe'), false);
});
test('gateway is ready even if hotspot blocks ICMP', async () => {
  const t = setup(); t.answer(JSON.stringify(physical));
  assert.equal(await t.api.gatewayReady(physical), true);
  assert.equal(t.calls.some((x) => x.file === 'ping.exe'), false);
});
test('endpoint route inspection reads AmneziaWG-owned /32 without creating another', async () => {
  const t = setup(); t.answer(JSON.stringify({ InterfaceIndex: 17, NextHop: '192.168.42.129' }));
  const routes = await t.api.endpointRoutes('203.0.113.11');
  assert.equal(routes.length, 1); assert.equal(routes[0].interfaceIndex, 17);
  assert.equal(t.calls.length, 1);
  assert.doesNotMatch(encodedScript(t.calls[0]), /New-NetRoute/);
});
