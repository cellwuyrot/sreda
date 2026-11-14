// Cross-language contract test: fake data only, no network, no real files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDecipheriv } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
test('python pilot plan can be sealed with the same per-admin credential', () => {
  const python = String.raw`
import sys, json
sys.path.insert(0, sys.argv[1])
try:
    import tomllib
except ModuleNotFoundError:
    import trusttunnel_vendor_tomli as tomllib
from trusttunnel_credentials import ManagedCredential
from trusttunnel_pilot_plan import prepare_pilot_plan
base = '[[client]]\nusername="smoke"\npassword="fixture"\n'
p = prepare_pilot_plan(base, [], ['admin_1'], 'turn.example.com', '192.0.2.4', 8443, generator=lambda: ManagedCredential('trioz_'+'a'*32, 'A'*43))
print(json.dumps({'payload': json.loads(p.sealer_input), 'endpoint': tomllib.loads(p.endpoint_credentials)}))
`;
  const result = spawnSync('python3', ['-c', python, join(root, 'apps/vpn/src')], {encoding:'utf8'});
  assert.equal(result.status, 0);
  const plan = JSON.parse(result.stdout);
  const dir = mkdtempSync(join(tmpdir(),'trioz-plan-'));
  try {
    const sealed = spawnSync(process.execPath, [join(root,'scripts/trusttunnel-pilot-seal.mjs'),dir], {input:JSON.stringify(plan.payload),encoding:'utf8'});
    assert.equal(sealed.status, 0);
    const key=readFileSync(join(dir,'pilot-key.txt'),'utf8').trim();
    const [version, iv, bytes, tag]=readFileSync(join(dir,'pilot-bundle.txt'),'utf8').trim().split('.');
    assert.equal(version,'v1');
    const decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(iv,'base64url'));
    decipher.setAAD(Buffer.from('trioz-trusttunnel-pilot-v1')); decipher.setAuthTag(Buffer.from(tag,'base64url'));
    const decoded=JSON.parse(Buffer.concat([decipher.update(Buffer.from(bytes,'base64url')),decipher.final()]).toString('utf8'));
    assert.equal(decoded.accounts[0].username,plan.endpoint.client[1].username);
    assert.equal(decoded.accounts[0].password,plan.endpoint.client[1].password);
    assert.equal(plan.endpoint.client[0].username,'smoke');
    assert.ok(!sealed.stdout.includes('A'.repeat(43))); assert.ok(!sealed.stderr.includes('A'.repeat(43)));
  } finally {rmSync(dir,{recursive:true,force:true});}
});
