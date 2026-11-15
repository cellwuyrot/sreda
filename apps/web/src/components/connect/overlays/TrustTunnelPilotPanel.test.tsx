import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const controls = vi.hoisted(() => ({ bridge: true, status: vi.fn(), up: vi.fn(), down: vi.fn(), other: vi.fn() }));
vi.mock('@/lib/trustTunnelClient', () => ({ getTrustTunnelEngine: () => controls.bridge ? controls : null }));
vi.mock('@/lib/vpnBridge', () => ({ getVpnBridge: () => ({ status: controls.other, down: vi.fn().mockResolvedValue({ state: 'off' }) }) }));
import TrustTunnelPilotPanel from './TrustTunnelPilotPanel';

beforeEach(() => {
  controls.bridge = true; vi.clearAllMocks();
  controls.status.mockResolvedValue({ state: 'off', error: null, confirmed: false });
  controls.up.mockResolvedValue({ state: 'on', error: null, confirmed: false });
  controls.down.mockResolvedValue({ state: 'off', error: null, confirmed: false });
  controls.other.mockResolvedValue({ state: 'off' });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function responses(access: object, applied = true) {
  let currentAccess = { ...access } as Record<string, unknown>;
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).endsWith('/config')) {
      currentAccess = { ...currentAccess, enabled: true, applied };
      return { ok: true, json: async () => applied
        ? { config: 'FAKE-PRIVATE-PROFILE', applied: true }
        : { applied: false } };
    }
    return { ok: true, json: async () => currentAccess };
  });
  vi.stubGlobal('fetch', fn); return fn;
}
const ready = { activeProvider: 'TRUSTTUNNEL', selected: true, serviceEnabled: true, available: true, eligible: true, enabled: true, applied: true, planLabel: 'Premium' };

describe('TrustTunnel subscriber panel', () => {
  it('renders project provider status without exposing profiles or technical credentials', async () => {
    responses(ready); const view = render(<TrustTunnelPilotPanel onClose={vi.fn()} />);
    expect(await screen.findByText('Надёжное соединение')).toBeTruthy();
    expect(await screen.findByText('Premium')).toBeTruthy();
    expect(view.container.textContent).not.toContain('FAKE-PRIVATE-PROFILE');
    expect(view.container.textContent).not.toContain('password =');
  });

  it('provisions a first-time entitled user, then waits for Endpoint ACK without receiving a profile', async () => {
    const fetch = responses({ ...ready, enabled: false, applied: false }, false);
    render(<TrustTunnelPilotPanel onClose={vi.fn()} />);
    const power = await screen.findByRole('button', { name: 'Подключить надёжное соединение' });
    expect((power as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(power);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/vpn/trusttunnel/config', expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByText('Ожидаем применение на сервере')).toBeTruthy();
    expect(controls.up).not.toHaveBeenCalled();
    expect((power as HTMLButtonElement).disabled).toBe(true);
  });

  it('connects only when the endpoint has applied the account', async () => {
    const fetch = responses(ready); render(<TrustTunnelPilotPanel onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Подключить надёжное соединение' }));
    await waitFor(() => expect(controls.up).toHaveBeenCalledWith('FAKE-PRIVATE-PROFILE'));
    expect(fetch).toHaveBeenCalledWith('/api/vpn/trusttunnel/config', expect.objectContaining({ method: 'POST' }));
    expect(fetch.mock.calls.some((call) => String(call[0]).endsWith('/config'))).toBe(true);
  });

  it('does not describe a Windows SCM service as a confirmed tunnel', async () => {
    controls.status.mockResolvedValue({ state: 'on', error: null, confirmed: false });
    responses(ready); render(<TrustTunnelPilotPanel onClose={vi.fn()} />);
    expect(await screen.findByText(/Служба запущена; прохождение трафика не подтверждено/)).toBeTruthy();
  });

  it('describes an Android engine connection reported as CONNECTED', async () => {
    controls.status.mockResolvedValue({ state: 'on', error: null, confirmed: true });
    responses(ready); render(<TrustTunnelPilotPanel onClose={vi.fn()} />);
    expect(await screen.findByText('Клиент подтвердил соединение')).toBeTruthy();
  });

  it('asks to switch off the other TrioZ VPN when it is active', async () => {
    controls.other.mockResolvedValue({ state: 'on' });
    responses(ready); render(<TrustTunnelPilotPanel onClose={vi.fn()} />);
    expect(await screen.findByText('Сначала отключите другое соединение TrioZ')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Отключить другое соединение/ })).toBeTruthy();
  });

  it('shows the shared service toggle when the admin has disabled the service', async () => {
    responses({ ...ready, serviceEnabled: false });
    render(<TrustTunnelPilotPanel onClose={vi.fn()} />);
    expect(await screen.findByText('Сервис отключён администратором')).toBeTruthy();
  });

  it('renders a clear project-wide provider mismatch', async () => {
    responses({ ...ready, selected: false, activeProvider: 'AMNEZIAWG', available: false });
    render(<TrustTunnelPilotPanel onClose={vi.fn()} />);
    expect(await screen.findByText('Эта технология сейчас не выбрана для проекта')).toBeTruthy();
  });
});
