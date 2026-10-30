// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAndroidVpnBridge } from "./androidVpn";
afterEach(() => {
  delete window.TriozVpnBridge;
  delete window.__androidVpnState;
  vi.useRealTimers();
});
function port(result: (request: Record<string, unknown>) => unknown) {
  const p = {
    onmessage: null as ((e: { data: string }) => void) | null,
    postMessage: vi.fn((raw: string) => {
      const request = JSON.parse(raw);
      queueMicrotask(() =>
        p.onmessage?.({
          data: JSON.stringify({ id: request.id, result: result(request) }),
        }),
      );
    }),
  };
  window.TriozVpnBridge = p;
  return p;
}
describe("Android origin-restricted message VPN adapter", () => {
  it("is absent in browser", () => expect(getAndroidVpnBridge()).toBeNull());
  it("does not accept the old unrestricted JS interface", () => {
    window.TriozVpnBridge = { up() {} } as never;
    expect(getAndroidVpnBridge()).toBeNull();
  });
  it("reads native public key without requesting private key", async () => {
    const p = port(() => "A".repeat(43) + "=");
    expect(await getAndroidVpnBridge()!.publicKey("user1")).toBe(
      "A".repeat(43) + "=",
    );
    expect(JSON.parse(p.postMessage.mock.calls[0][0]).op).toBe("publicKey");
  });
  it("rejects malformed public keys", async () => {
    port(() => "bad");
    await expect(getAndroidVpnBridge()!.publicKey("user1")).rejects.toThrow(
      "публичный ключ",
    );
  });
  it("passes a profile to native up", async () => {
    const p = port(() => ({
      state: "connecting",
      since: null,
      error: null,
      backend: "amneziawg",
    }));
    expect((await getAndroidVpnBridge()!.up("profile")).state).toBe(
      "connecting",
    );
    expect(JSON.parse(p.postMessage.mock.calls[0][0]).config).toBe("profile");
  });
  it("reports native admission error", async () => {
    const p = port(() => null);
    p.postMessage.mockImplementation((raw) => {
      const q = JSON.parse(raw);
      queueMicrotask(() =>
        p.onmessage?.({
          data: JSON.stringify({
            id: q.id,
            error: "VPN недоступен по политике",
          }),
        }),
      );
    });
    await expect(getAndroidVpnBridge()!.publicKey("user1")).rejects.toThrow(
      "по политике",
    );
  });
  it("receives state and unsubscribes", () => {
    port(() => null);
    const api = getAndroidVpnBridge()!;
    const fn = vi.fn();
    const off = api.onState(fn);
    window.__androidVpnState!(JSON.stringify({ state: "on" }));
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    window.__androidVpnState!(JSON.stringify({ state: "off" }));
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("ignores invalid state callbacks", () => {
    port(() => null);
    const fn = vi.fn();
    const off = getAndroidVpnBridge()!.onState(fn);
    window.__androidVpnState!("bad");
    window.__androidVpnState!('{"state":"invented"}');
    expect(fn).not.toHaveBeenCalled();
    off();
  });
  it("times out instead of hanging", async () => {
    vi.useFakeTimers();
    window.TriozVpnBridge = { postMessage: vi.fn(), onmessage: null };
    const request = getAndroidVpnBridge()!.status();
    const check = expect(request).rejects.toThrow("не ответил");
    await vi.advanceTimersByTimeAsync(15001);
    await check;
  });
  it("rejects invalid status replies", async () => {
    port(() => ({ state: "invalid" }));
    await expect(getAndroidVpnBridge()!.status()).rejects.toThrow("состояние");
  });
});
