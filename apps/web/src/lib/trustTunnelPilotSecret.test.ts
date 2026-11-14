import { chmodSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPilotSecret } from './trustTunnelPilotSecret';
let root: string; let file: string;
const contents = { key: 'ab'.repeat(32), bundle: 'v1.AA.BB.CC' };
beforeEach(() => {
  root = mkdtempSync(join(homedir(), '.pilot-secret-test-')); chmodSync(root, 0o700); file = join(root, 'bundle.json');
  writeFileSync(file, JSON.stringify(contents), { mode: 0o600 });
  vi.stubEnv('TRIOZ_TT_PILOT_SECRET_FILE', file);
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
describe.skipIf(process.platform === 'win32')('protected TrustTunnel secret file', () => {
  it('loads a protected record', () => expect(loadPilotSecret()).toEqual(contents));
  it('rejects world readable files and symlinks', () => {
    chmodSync(file, 0o644); expect(() => loadPilotSecret()).toThrow('Pilot secret unavailable');
    chmodSync(file, 0o600); const link=join(root,'link'); symlinkSync(file,link); vi.stubEnv('TRIOZ_TT_PILOT_SECRET_FILE',link);
    expect(() => loadPilotSecret()).toThrow('Pilot secret unavailable');
  });
  it('rejects hardlinks and writable parents', () => {
    const link=join(root,'link'); linkSync(file,link); expect(() => loadPilotSecret()).toThrow(); rmSync(link);
    chmodSync(root,0o777); expect(() => loadPilotSecret()).toThrow(); chmodSync(root,0o700);
  });
  it('does not fall back to environment on malformed configured file', () => {
    vi.stubEnv('TRIOZ_TT_PILOT_BUNDLE_KEY', contents.key); vi.stubEnv('TRIOZ_TT_PILOT_BUNDLE', contents.bundle);
    writeFileSync(file, JSON.stringify({...contents, extra:'PRIVATE'}));
    expect(() => loadPilotSecret()).toThrow('Pilot secret unavailable');
    try { loadPilotSecret(); } catch (error) { expect(String(error)).not.toContain('PRIVATE'); }
  });
  it('supports legacy environment only when no file is configured', () => {
    vi.stubEnv('TRIOZ_TT_PILOT_SECRET_FILE', ''); vi.stubEnv('TRIOZ_TT_PILOT_BUNDLE_KEY',contents.key); vi.stubEnv('TRIOZ_TT_PILOT_BUNDLE',contents.bundle);
    expect(loadPilotSecret()).toEqual(contents);
  });
  it('rejects relative path and symlinked directory', () => {
    vi.stubEnv('TRIOZ_TT_PILOT_SECRET_FILE', 'relative.json'); expect(() => loadPilotSecret()).toThrow();
    const target=join(root,'dir'); mkdirSync(target, {mode:0o700}); const real=join(target,'bundle'); writeFileSync(real,JSON.stringify(contents),{mode:0o600});
    const link=join(root,'symdir'); symlinkSync(target,link); vi.stubEnv('TRIOZ_TT_PILOT_SECRET_FILE',join(link,'bundle')); expect(() => loadPilotSecret()).toThrow();
  });
});
