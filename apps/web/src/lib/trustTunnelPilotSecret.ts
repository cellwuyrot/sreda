/** Linux server-side secret store. Never return values to a client or log them.
 * Operator must provision a root- or web-owned protected directory and a file
 * readable by the web process. Key + ciphertext together are still secrets.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { dirname, isAbsolute, normalize } from 'node:path';
export class PilotSecretError extends Error { constructor() { super('Pilot secret unavailable'); } }
export function loadPilotSecret(): { key: string; bundle: string } {
  const path = process.env.TRIOZ_TT_PILOT_SECRET_FILE;
  // Backward-compatible pilot-only input. Prefer protected file to process environment.
  if (!path) return { key: process.env.TRIOZ_TT_PILOT_BUNDLE_KEY ?? '', bundle: process.env.TRIOZ_TT_PILOT_BUNDLE ?? '' };
  try {
    if (typeof process.getuid !== 'function' || !isAbsolute(path) || normalize(path) !== path || path === '/') throw new PilotSecretError();
    const uid = process.getuid();
    // No symlinks or directories writable by untrusted group/other users.
    for (let current = dirname(path);;) {
      const st = lstatSync(current);
      if (!st.isDirectory() || st.isSymbolicLink() || (st.uid !== 0 && st.uid !== uid) || (st.mode & 0o022) !== 0) throw new PilotSecretError();
      if (current === '/') break;
      current = dirname(current);
    }
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const st = fstatSync(fd);
      if (!st.isFile() || (st.uid !== 0 && st.uid !== uid) || st.nlink !== 1 ||
          ![0o400, 0o440, 0o600, 0o640].includes(st.mode & 0o777) || st.size > 70000) throw new PilotSecretError();
      // Bound the read even if a concurrently writable file grows after fstat.
      const raw = Buffer.alloc(70001); let used = 0;
      try {
        while (used < raw.length) {
          const n = readSync(fd, raw, used, raw.length - used, null);
          if (n === 0) break;
          used += n;
        }
        if (used > 70000) throw new PilotSecretError();
        const obj: unknown = JSON.parse(raw.toString('utf8', 0, used));
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new PilotSecretError();
        const record = obj as Record<string, unknown>;
        if (Object.keys(record).sort().join(',') !== 'bundle,key' || typeof record.key !== 'string' || typeof record.bundle !== 'string' ||
            !/^[0-9a-f]{64}$/i.test(record.key) || record.bundle.length > 65536 || !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(record.bundle)) throw new PilotSecretError();
        return { key: record.key, bundle: record.bundle };
      } finally { raw.fill(0); }
    } finally { closeSync(fd); }
  } catch { throw new PilotSecretError(); }
}
