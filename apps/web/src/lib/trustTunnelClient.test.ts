import { afterEach, describe, expect, it, vi } from 'vitest';
const bridges = vi.hoisted(() => ({ android: null as unknown, desktop: null as unknown }));
vi.mock('./androidTrustTunnelPilot', () => ({ getAndroidTrustTunnelPilot: () => bridges.android }));
vi.mock('./desktop', () => ({ getDesktopApi: () => bridges.desktop }));
import { getTrustTunnelEngine } from './trustTunnelClient';
afterEach(() => { bridges.android = null; bridges.desktop = null; });
describe('TrustTunnel native selection', () => {
  it('selects Android bridge when present', () => { const engine = {}; bridges.android = engine; expect(getTrustTunnelEngine()).toBe(engine); });
  it('only selects the Windows bridge on Windows', () => {
    const engine = {}; bridges.desktop = { platform: 'win32', trustTunnel: engine }; expect(getTrustTunnelEngine()).toBe(engine);
    bridges.desktop = { platform: 'darwin', trustTunnel: engine }; expect(getTrustTunnelEngine()).toBeNull();
    bridges.desktop = { platform: 'win32' }; expect(getTrustTunnelEngine()).toBeNull();
  });
});
