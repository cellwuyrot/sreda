import { describe, expect, it } from 'vitest';
import { acquireVpnStart } from './vpnStartLock';
describe('native VPN start reservation', () => {
  it('prevents a second start until released; a second release is harmless', () => {
    const first = acquireVpnStart()!;
    expect(acquireVpnStart()).toBeNull();
    first(); const second = acquireVpnStart()!;
    first(); expect(acquireVpnStart()).toBeNull();
    second(); const third = acquireVpnStart(); expect(third).toBeTypeOf('function'); third!();
  });
});
