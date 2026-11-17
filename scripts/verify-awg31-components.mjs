#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'docs/awg31-components.json'), 'utf8'));
const target = process.argv[2] || 'all';
if (!['all', 'win32', 'android'].includes(target)) throw new Error('Expected all, win32 or android');
function verify(file, expected) {
  const actual = createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
  if (actual !== expected) throw new Error(`AWG 3.1 component mismatch: ${file}. Restore the pinned release or audit and update the manifest.`);
  console.log(`[AWG 3.1] OK ${file}`);
}
if (target === 'all' || target === 'win32') {
  for (const [file, digest] of Object.entries(manifest.windows.files)) verify(`apps/desktop/resources/wireguard/win32/${file}`, digest);
}
if (target === 'all' || target === 'android') {
  verify('apps/android/awg-tunnel/src/main/jniLibs/arm64-v8a/libwg-go.so', manifest.android.nativeSha256);
}
