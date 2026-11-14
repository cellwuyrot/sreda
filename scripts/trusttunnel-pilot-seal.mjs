#!/usr/bin/env node
/** Offline provisioning primitive; NOT wired to endpoints or service deployment.
 * Usage: node scripts/trusttunnel-pilot-seal.mjs /absolute/secure-directory < restricted-input.json
 * Input is sensitive JSON over stdin; NEVER pass passwords as CLI arguments.
 * It writes two exclusive mode-0600 files and never prints their contents.
 */
import { createCipheriv, randomBytes } from 'node:crypto';
import { openSync, writeFileSync, closeSync, fsyncSync, unlinkSync, lstatSync, constants } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { check } from './trusttunnel-pilot-format.mjs';

const fail = () => { throw new Error('Invalid or unsafe input'); };

async function main() {
  const dir = process.argv[2];
  if (process.argv.length !== 3 || typeof dir !== 'string' || !isAbsolute(dir) || process.stdin.isTTY) fail();
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && stat.uid !== process.getuid())) fail();
  let total = 0; const chunks = [];
  for await (const chunk of process.stdin) {
    total += chunk.length; if (total > 48000) fail(); chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  let data;
  try { data = JSON.parse(raw.toString('utf8')); check(data); } finally { raw.fill(0); }
  const key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('trioz-trusttunnel-pilot-v1'));
  const plain = Buffer.from(JSON.stringify(data));
  let encrypted;
  try { encrypted = Buffer.concat([cipher.update(plain), cipher.final()]); } finally { plain.fill(0); }
  const bundle = ['v1', iv.toString('base64url'), encrypted.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
  const keyPath = join(dir, 'pilot-key.txt'), bundlePath = join(dir, 'pilot-bundle.txt');
  const made = []; let committed = false;
  try {
    for (const [path, text] of [[keyPath, key.toString('hex')+'\n'], [bundlePath, bundle+'\n']]) {
      const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      made.push(path);
      try { writeFileSync(fd, text, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
    }
    const d = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(d); } finally { closeSync(d); }
    committed = true;
  } finally {
    key.fill(0);
    if (!committed) for (const p of made) { try { unlinkSync(p); } catch {} }
  }
  console.log('Created encrypted pilot bundle and key in the protected directory.');
}
main().catch(() => { console.error('Pilot bundle not created; check input and directory permissions.'); process.exitCode = 1; });
