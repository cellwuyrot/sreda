import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const controls = vi.hoisted(() => ({ bridge: true, status: vi.fn(), up: vi.fn(), down: vi.fn() }));
vi.mock('@/lib/androidTrustTunnelPilot', () => ({ getAndroidTrustTunnelPilot: () => controls.bridge ? controls : null }));
import TrustTunnelPilotPanel from './TrustTunnelPilotPanel';
beforeEach(() => {
  controls.bridge = true; vi.clearAllMocks();
  controls.status.mockResolvedValue({ state: 'off', error: null });
  controls.up.mockResolvedValue({ state: 'connecting', error: null });
  controls.down.mockResolvedValue({ state: 'off', error: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function fetchResponses(allowed: boolean, ready: boolean) {
  const fn = vi.fn(async (url: unknown) => String(url).endsWith('/config')
    ? { ok: true, json: async () => ({ config: 'FAKE-PRIVATE-PROFILE' }) }
    : { ok: allowed, json: async () => ({ eligible: allowed, connectionReady: ready }) });
  vi.stubGlobal('fetch', fn); return fn;
}
describe('TrustTunnel Android pilot', () => {
  it('does not query or render without the debug bridge', async () => {
    controls.bridge = false; const fetch = fetchResponses(true, true);
    const view = render(<TrustTunnelPilotPanel />); expect(view.container.textContent).toBe(''); expect(fetch).not.toHaveBeenCalled();
  });
  it('hides the pilot for a non-admin returned 404', async () => {
    fetchResponses(false, false); const view = render(<TrustTunnelPilotPanel />);
    await waitFor(() => expect(controls.status).toHaveBeenCalled()); expect(view.container.textContent).toBe('');
  });
  it('shows a disabled connect button until a profile is prepared', async () => {
    fetchResponses(true, false); render(<TrustTunnelPilotPanel />);
    const button = await screen.findByRole('button', { name: 'Подключить тестовый VPN' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
  it('requests profile only on user action and passes it only to bridge', async () => {
    const fetch = fetchResponses(true, true); const view = render(<TrustTunnelPilotPanel />);
    const button = await screen.findByRole('button', { name: 'Подключить тестовый VPN' });
    expect(fetch).toHaveBeenCalledTimes(1); fireEvent.click(button);
    await waitFor(() => expect(controls.up).toHaveBeenCalledWith('FAKE-PRIVATE-PROFILE'));
    expect(view.container.textContent).not.toContain('FAKE-PRIVATE-PROFILE');
    expect(fetch).toHaveBeenCalledWith('/api/vpn/trusttunnel/pilot/config', { method: 'POST', cache: 'no-store' });
  });
  it('allows stopping an active tunnel even after losing eligibility', async () => {
    controls.status.mockResolvedValue({ state: 'on', error: null }); fetchResponses(false, false);
    render(<TrustTunnelPilotPanel />); fireEvent.click(await screen.findByRole('button', { name: 'Отключить' }));
    await waitFor(() => expect(controls.down).toHaveBeenCalled());
  });
});
