import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createDecipheriv } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('./trusttunnel-pilot-seal.mjs', import.meta.url));
const entry = () => ({accountId:'admin1',hostname:'turn.example.com',gatewayIpv4:'192.0.2.4',port:8443,username:'trioz_'+'a'.repeat(32),password:'Z'.repeat(43)});
function run(path,obj) {return spawnSync(process.execPath,[script,path],{input:JSON.stringify(obj),encoding:'utf8'});}
test('protects and decrypts a fixture bundle, without printing credentials',()=>{
 const dir=mkdtempSync(join(tmpdir(),'tt-seal-'));
 try {
  const r=run(dir,{accounts:[entry()]}); assert.equal(r.status,0); assert.ok(!r.stdout.includes('Z'.repeat(43))); assert.ok(!r.stderr.includes('Z'.repeat(43)));
  const key=readFileSync(join(dir,'pilot-key.txt'),'utf8').trim(); const parts=readFileSync(join(dir,'pilot-bundle.txt'),'utf8').trim().split('.');
  assert.equal(statSync(join(dir,'pilot-key.txt')).mode & 0o777,0o600); assert.equal(statSync(join(dir,'pilot-bundle.txt')).mode & 0o777,0o600);
  const decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(parts[1],'base64url')); decipher.setAAD(Buffer.from('trioz-trusttunnel-pilot-v1')); decipher.setAuthTag(Buffer.from(parts[3],'base64url'));
  const data=JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[2],'base64url')),decipher.final()])); assert.equal(data.accounts[0].accountId,'admin1');
  const again=run(dir,{accounts:[entry()]}); assert.notEqual(again.status,0); assert.equal(readFileSync(join(dir,'pilot-key.txt'),'utf8').trim(),key);
 } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('rejects weak directory, repeated credentials and extras',()=>{
 const dir=mkdtempSync(join(tmpdir(),'tt-seal-'));
 try {
  chmodSync(dir,0o755); assert.notEqual(run(dir,{accounts:[entry()]}).status,0); chmodSync(dir,0o700);
  assert.notEqual(run(dir,{accounts:[entry(),{...entry(),accountId:'admin2',username:'trioz_'+'b'.repeat(32)}]}).status,0);
  assert.notEqual(run(dir,{accounts:[{...entry(),hostname:'bad\ninjected'}]}).status,0);
  assert.notEqual(run(dir,{accounts:[{...entry(),unexpected:'sensitive'}]}).status,0);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
