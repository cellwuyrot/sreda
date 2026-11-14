#!/usr/bin/env node
/** Verifies a protected transferred connect secret. No values are printed. */
import { constants, openSync, fstatSync, readFileSync, closeSync, lstatSync } from 'node:fs';
import { createDecipheriv } from 'node:crypto';
import { dirname, isAbsolute, normalize } from 'node:path';
import { check } from './trusttunnel-pilot-format.mjs';
const fail=()=>{throw Error('Invalid secret');};
function main() {
  if (process.argv.length!==3 || typeof process.getuid!=='function') fail();
  const path=process.argv[2];
  if (!isAbsolute(path) || normalize(path)!==path) fail();
  for(let dir=dirname(path);;) {
    const st=lstatSync(dir);
    if (!st.isDirectory() || st.isSymbolicLink() || (st.uid!==0 && st.uid!==process.getuid()) || (st.mode & 0o022)) fail();
    if(dir==='/') break; dir=dirname(dir);
  }
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  let raw, plain, key;
  try {
    const st=fstatSync(fd);
    if(!st.isFile() || st.nlink!==1 || (st.uid!==0 && st.uid!==process.getuid()) || ![0o400,0o440,0o600,0o640].includes(st.mode & 0o777) || st.size>70000) fail();
    raw=readFileSync(fd); if(raw.length>70000) fail();
    const doc=JSON.parse(raw.toString('utf8'));
    if(!doc || Object.keys(doc).sort().join(',')!=='bundle,key' || typeof doc.key!=='string' || !/^[a-f0-9]{64}$/i.test(doc.key) || typeof doc.bundle!=='string') fail();
    const parts=doc.bundle.split('.');
    if(parts.length!==4 || parts[0]!=='v1' || parts.slice(1).some(x=>!x || !/^[A-Za-z0-9_-]+$/.test(x) || Buffer.from(x,'base64url').toString('base64url')!==x)) fail();
    const iv=Buffer.from(parts[1],'base64url'), encrypted=Buffer.from(parts[2],'base64url'), tag=Buffer.from(parts[3],'base64url');
    if(iv.length!==12 || tag.length!==16 || encrypted.length>48000) fail();
    key=Buffer.from(doc.key,'hex'); const decipher=createDecipheriv('aes-256-gcm',key,iv);
    decipher.setAAD(Buffer.from('trioz-trusttunnel-pilot-v1')); decipher.setAuthTag(tag);
    plain=Buffer.concat([decipher.update(encrypted),decipher.final()]); check(JSON.parse(plain.toString('utf8')));
  } finally { raw?.fill(0); plain?.fill(0); key?.fill(0); closeSync(fd); }
}
try { main(); console.log('Protected pilot secret is valid.'); }
catch { console.error('Protected pilot secret is invalid or inaccessible.'); process.exitCode=1; }
