import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ android: vi.fn(), device: vi.fn() }));
vi.mock("@/lib/androidVpn", () => ({ getAndroidVpnBridge: mocks.android }));
vi.mock("@/lib/wgIdentity", () => ({ deviceKeyPair: mocks.device }));
import { vpnEnrollmentKeys } from "./vpnEnrollment";
afterEach(() => vi.unstubAllGlobals());
describe("account scoped native enrollment", () => {
  it("keeps browser/desktop behavior", async () => {
    mocks.android.mockReturnValue(null);
    mocks.device.mockReturnValue({ publicKey: "pub", privateKey: "secret" });
    expect(await vpnEnrollmentKeys()).toEqual({
      publicKey: "pub",
      privateKey: "secret",
    });
  });
  it("requests native public key for authenticated account only", async () => {
    const publicKey = vi.fn().mockResolvedValue("native-public");
    mocks.android.mockReturnValue({ publicKey });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({ user: { id: "user1" } }),
        }),
    );
    const result = await vpnEnrollmentKeys();
    expect(publicKey).toHaveBeenCalledWith("user1");
    expect(result.publicKey).toBe("native-public");
    expect(result.privateKey).toBe("A".repeat(43) + "=");
  });
  it("does not register a key when session is absent", async () => {
    mocks.android.mockReturnValue({ publicKey: vi.fn() });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );
    await expect(vpnEnrollmentKeys()).rejects.toThrow("Войдите");
  });
  it("propagates native admission denial before enrolling peer", async () => {
    mocks.android.mockReturnValue({
      publicKey: vi.fn().mockRejectedValue(new Error("Policy denied")),
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({ user: { id: "user1" } }),
        }),
    );
    await expect(vpnEnrollmentKeys()).rejects.toThrow("Policy denied");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
