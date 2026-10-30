import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const native = vi.hoisted(() => ({
  publicKey: vi.fn(),
  status: vi.fn(),
  up: vi.fn(),
  down: vi.fn(),
  onState: vi.fn(),
  admission: vi.fn(),
}));
vi.mock("@/lib/androidVpn", () => ({ getAndroidVpnBridge: () => native }));
vi.mock("@/lib/desktop", () => ({
  getDesktopApi: () => null,
  isDesktop: () => false,
}));
vi.mock("@/lib/shell", () => ({ isAndroidShell: () => true }));
vi.mock("@/lib/wgIdentity", () => ({
  deviceKeyPair: () => {
    throw Error("Android must not use JS private key");
  },
}));
vi.mock("@/lib/wgKeys", () => ({
  buildWireGuardConfig: () => "native-profile-placeholder",
}));
vi.mock("@/lib/useLinkMetrics", () => ({
  useLinkMetrics: () => ({
    lost: false,
    pingMs: null,
    speedBusy: false,
    speedMbits: null,
    speedError: "",
    measureSpeed: vi.fn(),
  }),
}));
import PremiumInfoModal from "./PremiumInfoModal";
const peer = {
  nodeId: "n1",
  address: "10.8.0.2/32",
  routing: "ALL",
  tunnel: {
    serverPublicKey: "server-key",
    endpoint: "192.0.2.1:51820",
    dns: "1.1.1.1",
    allowedIps: "0.0.0.0/0",
    extra: null,
  },
};
function data() {
  return {
    entitled: true,
    serviceEnabled: true,
    nodeReady: true,
    peer: null,
    peerApplied: true,
    plan: { kind: "premium", label: "Premium", until: null },
    servers: [
      {
        id: "n1",
        name: "Тестовый сервер",
        region: "Тест",
        ready: true,
        full: false,
      },
    ],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  native.publicKey.mockResolvedValue("native-public");
  native.status.mockResolvedValue({
    state: "off",
    since: null,
    error: null,
    backend: null,
  });
  native.onState.mockReturnValue(() => {});
  native.up.mockResolvedValue({ state: "connecting" });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (input: unknown, init?: RequestInit) =>
        ({
          ok: true,
          json: async () =>
            String(input) === "/api/auth/session"
              ? { user: { id: "user1" } }
              : init?.method === "POST"
                ? { peer }
                : data(),
        }) as never,
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function connect() {
  render(<PremiumInfoModal isPremium onClose={() => {}} />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Тестовый сервер/ }),
  );
  const button = screen.getByRole("button", {
    name: /^Включить защищённое соединение$/i,
  });
  await waitFor(() =>
    expect((button as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(button);
}
describe("Android native VPN flow", () => {
  it("enrolls native public key, waits peer and calls native up", async () => {
    await connect();
    await waitFor(() =>
      expect(native.up).toHaveBeenCalledWith("native-profile-placeholder"),
    );
    expect(native.publicKey).toHaveBeenCalledWith("user1");
    const calls = vi
      .mocked(fetch)
      .mock.calls.filter(([, init]) => init?.method === "POST");
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0][1]?.body)).publicKey).toBe(
      "native-public",
    );
  });
  it("denies enrollment before sending a public key to server", async () => {
    native.publicKey.mockRejectedValue(
      new Error("VPN недоступен по политике этой сборки"),
    );
    await connect();
    await screen.findByText("VPN недоступен по политике этой сборки");
    expect(native.up).not.toHaveBeenCalled();
    expect(
      vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "POST"),
    ).toBe(false);
  });
  it("does not offer Android config export", async () => {
    render(<PremiumInfoModal isPremium onClose={() => {}} />);
    await screen.findByRole("button", { name: /Тестовый сервер/ });
    expect(screen.queryByText("Скачать профиль для AmneziaVPN")).toBeNull();
  });
});
