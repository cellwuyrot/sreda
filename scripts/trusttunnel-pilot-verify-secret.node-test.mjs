import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
const root=resolve('.'); const seal=join(root,'scripts/trusttunnel-pilot-seal.mjs'), verify=join(root,'scripts/trusttunnel-pilot-verify-secret.mjs');
const row={accountId:'admin',hostname:'turn.example.com',gatewayIpv4:'192.0.2.4',port:8443,username:'trioz_'+'a'.repeat(32),password:'X'.repeat(43)};
test('validates transferred encrypted data and fails closed on tampering', {skip: process.platform === 'win32'}, () => {
 const dir=mkdtempSync(join(homedir(),'.tt-verify-')); chmodSync(dir,0o700);
 try {
  const p=spawnSync(process.execPath,[seal,dir],{input:JSON.stringify({accounts:[row]}),encoding:'utf8'}); assert.equal(p.status,0);
  const doc={key:readFileSync(join(dir,'pilot-key.txt'),'utf8').trim(),bundle:readFileSync(join(dir,'pilot-bundle.txt'),'utf8').trim()};
  const file=join(dir,'secret.json'); writeFileSync(file,JSON.stringify(doc),{mode:0o600});
  const run=path=>spawnSync(process.execPath,[verify,path],{encoding:'utf8'});
  let result=run(file); assert.equal(result.status,0); assert.ok(!result.stdout.includes(row.password));
  doc.key='00'.repeat(32); writeFileSync(file,JSON.stringify(doc)); result=run(file); assert.notEqual(result.status,0); assert.ok(!result.stderr.includes(row.password));
  chmodSync(file,0o644); assert.notEqual(run(file).status,0); chmodSync(file,0o600);
  const link=join(dir,'link'); symlinkSync(file,link); assert.notEqual(run(link).status,0);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
