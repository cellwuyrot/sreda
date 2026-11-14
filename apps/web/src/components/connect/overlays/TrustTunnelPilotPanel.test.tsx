import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const controls = vi.hoisted(() => ({ bridge: true, status: vi.fn(), up: vi.fn(), down: vi.fn() }));
vi.mock('@/lib/trustTunnelClient', () => ({ getTrustTunnelEngine: () => controls.bridge ? controls : null }));
import TrustTunnelPilotPanel from './TrustTunnelPilotPanel';
beforeEach(() => {
  controls.bridge = true; vi.clearAllMocks();
  controls.status.mockResolvedValue({ state: 'off', error: null });
  controls.up.mockResolvedValue({ state: 'on', error: null });
  controls.down.mockResolvedValue({ state: 'off', error: null });
  vi.stubGlobal('confirm', vi.fn(() => true));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function responses(access: object, applied = true) {
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => String(url).endsWith('/config')
    ? { ok: true, json: async () => init?.method === 'DELETE' ? { ok: true } : { config: 'FAKE-PRIVATE-PROFILE', applied } }
    : { ok: true, json: async () => access });
  vi.stubGlobal('fetch', fn); return fn;
}
const ready = { available: true, eligible: true, enabled: true, applied: true };
describe('TrustTunnel subscriber panel', () => {
  it('does not query or render without a supported native bridge', () => {
    controls.bridge = false; const fetch = responses(ready);
    expect(render(<TrustTunnelPilotPanel />).container.textContent).toBe(''); expect(fetch).not.toHaveBeenCalled();
  });
  it('hides for an ineligible inactive account', async () => {
    responses({ ...ready, eligible: false }); const view = render(<TrustTunnelPilotPanel />);
    await waitFor(() => expect(controls.status).toHaveBeenCalled()); expect(view.container.textContent).toBe('');
  });
  it('issues only on action and never displays the profile', async () => {
    const fetch = responses(ready); const view = render(<TrustTunnelPilotPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Подключить' }));
    await waitFor(() => expect(controls.up).toHaveBeenCalledWith('FAKE-PRIVATE-PROFILE'));
    expect(view.container.textContent).not.toContain('FAKE-PRIVATE-PROFILE');
    expect(fetch).toHaveBeenCalledWith('/api/vpn/trusttunnel/config', expect.objectContaining({ method: 'POST', body: '{"rotate":false}' }));
  });
  it('waits for server application instead of connecting a pending profile', async () => {
    responses({ ...ready, enabled: false, applied: false }, false); render(<TrustTunnelPilotPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Подключить' }));
    expect(await screen.findByText(/Профиль отправлен на активацию/)).toBeTruthy(); expect(controls.up).not.toHaveBeenCalled();
  });
  it('allows stopping an active tunnel after losing eligibility', async () => {
    controls.status.mockResolvedValue({ state: 'on', error: null }); responses({ ...ready, eligible: false });
    render(<TrustTunnelPilotPanel />); fireEvent.click(await screen.findByRole('button', { name: 'Отключить' }));
    await waitFor(() => expect(controls.down).toHaveBeenCalled());
  });
  it('rotates and revokes only with confirmation and without passing profile to engine', async () => {
    const fetch = responses(ready); render(<TrustTunnelPilotPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Обновить ключ' }));
    await screen.findByText(/Ключ обновлён/); expect(controls.up).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('/api/vpn/trusttunnel/config', expect.objectContaining({ body: '{"rotate":true}' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отозвать доступ' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/vpn/trusttunnel/config', expect.objectContaining({ method: 'DELETE' })));
  });
});
