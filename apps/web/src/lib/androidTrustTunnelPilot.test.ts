import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAndroidTrustTunnelPilot } from './androidTrustTunnelPilot';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function fake() {
  const port = { onmessage: null as null | ((e: { data: string }) => void), postMessage: vi.fn((_message: string) => {}) };
  vi.stubGlobal('window', { TriozTrustTunnelPilotBridge: port });
  return port;
}
describe('Android TrustTunnel pilot bridge', () => {
  it('is unavailable without native bridge', () => { vi.stubGlobal('window', {}); expect(getAndroidTrustTunnelPilot()).toBeNull(); });
  it('correlates a request and accepts only valid state', async () => {
    const port = fake(); const bridge = getAndroidTrustTunnelPilot()!; const promise = bridge.status();
    const sent = JSON.parse(port.postMessage.mock.calls[0][0] as string);
    expect(sent.op).toBe('status');
    port.onmessage!({ data: JSON.stringify({ id: sent.id, result: { state: 'on', error: null } }) });
    await expect(promise).resolves.toEqual({ state: 'on', error: null });
  });
  it('rejects invalid state and ignores responses with the wrong id', async () => {
    const port = fake(); const promise = getAndroidTrustTunnelPilot()!.status();
    const sent = JSON.parse(port.postMessage.mock.calls[0][0] as string);
    port.onmessage!({ data: JSON.stringify({ id: 'wrong', result: { state: 'on', error: null } }) });
    port.onmessage!({ data: JSON.stringify({ id: sent.id, result: { state: 'invented', error: null } }) });
    await expect(promise).rejects.toThrow('Некорректный ответ VPN');
  });
  it('returns a generic failure if the port cannot send, without echoing the profile', async () => {
    const port = fake(); port.postMessage.mockImplementation(() => { throw Error('FAKE-SECRET'); });
    await expect(getAndroidTrustTunnelPilot()!.up('FAKE-SECRET')).rejects.toThrow('Не удалось обратиться к Android VPN');
  });
  it('times out unanswered requests', async () => {
    vi.useFakeTimers(); fake(); const result = getAndroidTrustTunnelPilot()!.status();
    const assertion = expect(result).rejects.toThrow('Android VPN не ответил');
    await vi.advanceTimersByTimeAsync(15000); await assertion;
  });
});
