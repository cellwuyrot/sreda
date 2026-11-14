#!/usr/bin/env node
/** Internal verifier of an owner-only staged snapshot. Never prints contents. */
import { constants, openSync, fstatSync, readFileSync, closeSync, lstatSync } from 'node:fs';
import { createDecipheriv } from 'node:crypto';
import { join, isAbsolute } from 'node:path';
const fail=()=>{ throw Error('Invalid staged snapshot'); };
function read(path, limit) {
  const fd=openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st=fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid() || (st.mode & 0o777) !== 0o600 || st.size > limit) fail();
    const b=readFileSync(fd); if (b.length > limit) fail(); return b;
  } finally { closeSync(fd); }
}
function main() {
  if (typeof process.getuid !== 'function' || process.argv.length !== 3 || !isAbsolute(process.argv[2])) fail();
  const dir=process.argv[2], s=lstatSync(dir);
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid() || (s.mode & 0o777) !== 0o700) fail();
  const buffers=[];
  try {
    const take=(name,max)=>{const b=read(join(dir,name),max); buffers.push(b); return b;};
    const mapping=JSON.parse(take('pilot-mapping.json',48000).toString('utf8'));
    const secret=JSON.parse(take('pilot-server-secret.json',70000).toString('utf8'));
    if (!secret || Object.keys(secret).sort().join(',') !== 'bundle,key' || !/^[a-f0-9]{64}$/i.test(secret.key)) fail();
    const parts=typeof secret.bundle === 'string' ? secret.bundle.split('.') : [];
    if (parts.length!==4 || parts[0]!=='v1' || parts.slice(1).some(x=>!x || !/^[A-Za-z0-9_-]+$/.test(x) || Buffer.from(x,'base64url').toString('base64url')!==x)) fail();
    const iv=Buffer.from(parts[1],'base64url'), ciphertext=Buffer.from(parts[2],'base64url'), tag=Buffer.from(parts[3],'base64url');
    if (iv.length!==12 || tag.length!==16 || ciphertext.length>48000) fail();
    const key=Buffer.from(secret.key,'hex'); buffers.push(key);
    const cipher=createDecipheriv('aes-256-gcm',key,iv); cipher.setAAD(Buffer.from('trioz-trusttunnel-pilot-v1')); cipher.setAuthTag(tag);
    const plain=Buffer.concat([cipher.update(ciphertext),cipher.final()]); buffers.push(plain);
    if (JSON.stringify(JSON.parse(plain.toString('utf8'))) !== JSON.stringify(mapping)) fail();
    if (take('pilot-key.txt',128).toString('utf8').trim()!==secret.key || take('pilot-bundle.txt',65536).toString('utf8').trim()!==secret.bundle) fail();
  } finally { for (const b of buffers) b.fill(0); }
}
try { main(); console.log('Staged encrypted bundle matches mapping.'); }
catch { console.error('Staged encrypted bundle failed verification.'); process.exitCode=1; }
