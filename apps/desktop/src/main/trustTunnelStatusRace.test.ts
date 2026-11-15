import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ service: vi.fn(), elevated: vi.fn(), vpn: vi.fn(), send: vi.fn() }));
vi.mock("../shared/constants", () => ({ IPC: { TT_STATE: "tt:state" } }));
vi.mock("electron", () => ({ app: { isPackaged: false, getAppPath: () => "C:\\App", getPath: () => "C:\\Data" } }));
vi.mock("./trustTunnelService", () => ({ trustTunnelServiceState: mocks.service }));
vi.mock("./mainWindow", () => ({ getMainWindow: () => ({ webContents: { send: mocks.send } }) }));
vi.mock("./winTunnel", () => ({ elevatedScript: mocks.elevated }));
vi.mock("./vpn", () => ({ isVpnActive: mocks.vpn }));
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
afterEach(() => { Object.defineProperty(process, "platform", originalPlatform); vi.resetModules(); vi.clearAllMocks(); });

describe("TrustTunnel status probe races", () => {
  it("does not overwrite a newer disconnect with a stale running probe", async () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    let resolveProbe!: (value: string) => void;
    mocks.service.mockReset().mockImplementationOnce(() => new Promise<string>((resolve) => { resolveProbe = resolve; }))
      .mockResolvedValueOnce("absent").mockResolvedValueOnce("absent");
    const tunnel = await import("./trustTunnel");
    const oldProbe = tunnel.trustTunnelStatus();
    expect((await tunnel.trustTunnelDown()).state).toBe("off");
    resolveProbe("running");
    expect((await oldProbe).state).toBe("off");
  });
  it("does not overwrite a newer failed start with a stale running probe", async () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    let resolveProbe!: (value: string) => void;
    mocks.service.mockReset().mockImplementationOnce(() => new Promise<string>((resolve) => { resolveProbe = resolve; }));
    const tunnel = await import("./trustTunnel");
    const oldProbe = tunnel.trustTunnelStatus();
    expect((await tunnel.trustTunnelUp("invalid")).state).toBe("error");
    resolveProbe("running");
    expect((await oldProbe).state).toBe("error");
  });
});
