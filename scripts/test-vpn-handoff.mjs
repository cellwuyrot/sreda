import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'apps/desktop/src/main/networkHandoff.ts'), 'utf8');
const code = esbuild.transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
const mod = { exports: {} };
let now = 0;
vm.runInNewContext(code, { module: mod, exports: mod.exports, Date: { now: () => now }, console });
const { NetworkHandoff, routeChanged } = mod.exports;
const wifi = { interfaceIndex: 12, interfaceAlias: 'Wi-Fi', gateway: '192.168.1.1', localAddress: '192.168.1.20', dnsServers: ['192.168.1.1'] };
const hotspot = { ...wifi, interfaceIndex: 17, gateway: '192.168.42.129', localAddress: '192.168.42.10', dnsServers: ['192.168.42.129'] };
function setup(options = {}) {
  now = 1000;
  let physical = wifi, active = true, ready = true, failures = 0;
  const calls = [], messages = [], logs = [];
  const controller = new NetworkHandoff({
    physical: async () => { calls.push('physical'); return physical; },
    ready: async () => ready,
    recover: async (r, cancelled) => { calls.push('recover:' + r.gateway); if (cancelled()) return false; if (failures-- > 0) return false; return true; },
    active: () => active,
    status: (m, failed) => messages.push({ m, failed }),
    log: (m) => logs.push(m),
    sleep: async (ms) => { now += ms; if (options.onSleep) options.onSleep(ms); },
  });
  controller.setBaseline(wifi);
  return { controller, calls, messages, logs, setRoute: (r) => { physical = r; }, setActive: (v) => { active = v; }, setReady: (v) => { ready = v; }, setFailures: (n) => { failures = n; } };
}
test('unchanged gateway/interface/IP does not reconnect', async () => { const t = setup(); await t.controller.scan(); assert.equal(t.calls.includes('recover:' + wifi.gateway), false); });
test('gateway change triggers reconnect', async () => { const t = setup(); t.setRoute({ ...wifi, gateway: '192.168.1.2' }); await t.controller.scan(); assert.ok(t.calls.includes('recover:192.168.1.2')); });
test('InterfaceIndex change triggers reconnect', async () => { const t = setup(); t.setRoute({ ...wifi, interfaceIndex: 21 }); await t.controller.scan(); assert.equal(t.calls.filter(x => x.startsWith('recover:')).length, 1); });
test('Wi-Fi to hotspot rebuilds baseline and logs both gateways', async () => { const t = setup(); t.setRoute(hotspot); await t.controller.scan(); assert.equal(t.controller.getBaseline().gateway, hotspot.gateway); assert.ok(t.logs.some(x => x.includes('OLD_GATEWAY=192.168.1.1'))); assert.ok(t.logs.some(x => x.includes('NEW_GATEWAY=192.168.42.129'))); });
test('route difference includes DNS/profile and local IPv4', () => { assert.equal(routeChanged(wifi, { ...wifi, dnsServers: ['8.8.8.8'] }), true); assert.equal(routeChanged(wifi, { ...wifi, localAddress: '192.168.1.21' }), true); });
test('no gateway yet waits then reconnects on hotspot', async () => { const t = setup({ onSleep: () => { if (!switched) { t.setRoute(hotspot); switched = true; } } }); let switched = false; t.setRoute(null); await t.controller.scan(); assert.equal(t.controller.getBaseline().gateway, hotspot.gateway); });
test('no gateway times out and does not loop', async () => { const t = setup(); t.setRoute(null); await t.controller.scan(); assert.equal(t.messages.at(-1).failed, true); const before = t.calls.length; await t.controller.scan(); assert.equal(t.calls.length, before + 1); });
test('unreachable endpoint retries with bounded exponential backoff', async () => { const t = setup(); t.setRoute(hotspot); t.setFailures(3); await t.controller.scan(); assert.equal(t.calls.filter(x => x.startsWith('recover:')).length, 3); assert.equal(t.messages.at(-1).failed, true); assert.equal(now, 1000 + 1500 + 2000 + 4000); });
test('missing handshake retries then succeeds', async () => { const t = setup(); t.setRoute(hotspot); t.setFailures(1); await t.controller.scan(); assert.equal(t.calls.filter(x => x.startsWith('recover:')).length, 2); assert.equal(t.controller.getBaseline().gateway, hotspot.gateway); });
test('successful reconnect does not re-enter on same network', async () => { const t = setup(); t.setRoute(hotspot); await t.controller.scan(); await t.controller.scan(); assert.equal(t.calls.filter(x => x.startsWith('recover:')).length, 1); });
test('VPN off ignores network change', async () => { const t = setup(); t.setActive(false); t.setRoute(hotspot); await t.controller.scan(); assert.equal(t.calls.length, 0); });
test('VPN error with user intent retries on new network event', async () => { const t = setup(); t.setRoute(hotspot); t.setFailures(5); await t.controller.scan(); t.setRoute({ ...hotspot, gateway: '192.168.42.1' }); t.setFailures(0); await t.controller.scan(); assert.equal(t.controller.getBaseline().gateway, '192.168.42.1'); });
test('cancel prevents restart after user turned VPN off', async () => { const t = setup({ onSleep: () => { t.setActive(false); void t.controller.cancel(); } }); t.setRoute(hotspot); await t.controller.scan(); assert.equal(t.calls.filter(x => x.startsWith('recover:')).length, 0); });
test('handshake never accepted by route controller unless recover verifies it', async () => { const t = setup(); t.setRoute(hotspot); t.setFailures(9); await t.controller.scan(); assert.equal(t.controller.getBaseline().gateway, wifi.gateway); });
test('owned-route and handshake safeguards are present in Windows backend', () => {
  const source = readFileSync(resolve(root, 'apps/desktop/src/main/winNetwork.ts'), 'utf8');
  assert.match(source, /Remove-NetRoute/); assert.match(source, /New-NetRoute/); assert.match(source, /Get-NetRoute.*DestinationPrefix/);
  assert.match(source, /latest-handshakes/); assert.match(source, /Received handshake response/); assert.match(source, /refusing to modify unowned route/);
  const client = readFileSync(resolve(root, 'apps/desktop/src/shared/vpnClient.ts'), 'utf8');
  assert.doesNotMatch(client.match(/export function serviceNames[\s\S]*?\n}/)?.[0] || '', /WireGuardTunnel\$/);
});
