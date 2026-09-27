import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const code = esbuild.transformSync(readFileSync(resolve(import.meta.dirname, '../apps/desktop/src/main/winTunnel.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
function moduleWith(run = async () => ({ stdout: '' })) {
  const mod = { exports: {} };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, Buffer, process: { env: {} }, console,
    setTimeout, require: (name) => name === 'node:util' ? { promisify: () => run }
      : name === '../shared/vpnPlan' ? { TUNNEL_CONF_FILE: 'trioz.conf', TUNNEL_NAME: 'trioz' }
      : name === '../shared/vpnClient' ? { serviceNames: () => ['AmneziaWGTunnel$trioz'], stableClientDir: () => 'C:/TrioZ/vpn', systemClientCandidates: () => [], WIN_CLIENT_OPTIONAL: [], WIN_SERVICE_HINT: 'fail' }
      : require(name) });
  return mod.exports;
}
test('adapter absent and service missing: VPN is physically off', async () => {
  const api = moduleWith(async (file) => { if (file === 'sc.exe') throw new Error('service missing'); return { stdout: '' }; });
  assert.equal(await api.windowsTunnelExists(), false);
});
test('crash with TrioZ adapter present: cleanup detects it', async () => {
  const api = moduleWith(async (file, args) => { if (file === 'sc.exe') throw new Error('service missing'); return { stdout: file === 'powershell.exe' && args.at(-1).includes('Get-NetAdapter') ? 'Up' : '' }; });
  assert.equal(await api.windowsTunnelExists(), true);
});
test('normal stop waits for service, PID and adapter disappearance', async () => {
  const api = moduleWith(); let clock = 0, stopped = false, removed = false, clears = 0, fallback = 0;
  const runtime = {
    now: () => clock, sleep: async (ms) => { clock += ms; if (clock > 700) removed = true; },
    services: async () => [{ name: 'AmneziaWGTunnel$trioz', state: !stopped ? 'RUNNING' : removed ? 'MISSING' : 'STOPPED', pid: !removed ? 42 : null }],
    discoverPids: async () => [42], processExists: async () => !removed,
    adapterStatus: async () => removed ? '' : 'Up', uninstall: async () => { stopped = true; },
    fallback: async () => { fallback++; }, removeConfig: () => { clears++; },
  };
  await api.windowsTunnelDown('', runtime);
  assert.equal(fallback, 0); assert.equal(clears, 1); assert.equal(removed, true);
});
test('stuck adapter after crash uses bounded TrioZ-only fallback', async () => {
  const api = moduleWith(); let clock = 0, removed = false, fallback = 0;
  const runtime = {
    now: () => clock, sleep: async (ms) => { clock += ms; },
    services: async () => [{ name: 'AmneziaWGTunnel$trioz', state: removed ? 'MISSING' : 'STOP_PENDING', pid: removed ? null : 42 }],
    discoverPids: async () => [42], processExists: async () => !removed,
    adapterStatus: async () => removed ? '' : 'Up', uninstall: async () => {},
    fallback: async (_, pids) => { fallback++; assert.deepEqual([...pids], [42]); removed = true; }, removeConfig: () => {},
  };
  await api.windowsTunnelDown('', runtime);
  assert.equal(fallback, 1); assert.equal(removed, true);
});
