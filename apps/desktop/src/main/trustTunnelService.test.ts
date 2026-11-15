import { describe, expect, it, vi } from "vitest";
import { parseServiceProbe, probeTrustTunnelService, SERVICE_PROBE } from "./trustTunnelService";

describe("language-independent TrustTunnel service probe", () => {
  it("maps exact numeric SCM status and treats malformed/paused values as unknown", () => {
    expect(parseServiceProbe("TRIOZ_TT_STATE=4\r\n")).toBe("running");
    expect(parseServiceProbe("TRIOZ_TT_STATE=1\n")).toBe("stopped");
    for (const n of [2, 3, 5, 6]) expect(parseServiceProbe(`TRIOZ_TT_STATE=${n}`)).toBe("pending");
    expect(parseServiceProbe("TRIOZ_TT_STATE=ABSENT")).toBe("absent");
    for (const v of ["", "TRIOZ_TT_STATE=7", "TRIOZ_TT_STATE=4garbage", "state=4", "TRIOZ_TT_STATE=UNKNOWN"]) expect(parseServiceProbe(v)).toBe("unknown");
  });
  it("queries only our fixed local service and uses no profile data", () => {
    expect(SERVICE_PROBE).toContain("TrioZTrustTunnel");
    expect(SERVICE_PROBE).toContain("[int]$s.Status");
    expect(SERVICE_PROBE).not.toMatch(/client\.toml|password|username|http/i);
  });
  it("returns the PowerShell result without depending on sc output localization", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "TRIOZ_TT_STATE=4\r\n" });
    expect(await probeTrustTunnelService(run)).toBe("running");
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("falls back to Russian sc output when PowerShell cannot report", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({ stdout: "Состояние          : 4  RUNNING\r\n" });
    expect(await probeTrustTunnelService(run)).toBe("running");
  });
  it("returns absent on a definitive missing-service result, not on generic failures", async () => {
    const missing = vi.fn().mockRejectedValueOnce(new Error("unavailable"))
      .mockRejectedValueOnce({ stdout: "[SC] OpenService FAILED 1060" });
    expect(await probeTrustTunnelService(missing)).toBe("absent");
    const denied = vi.fn().mockRejectedValueOnce(new Error("denied"))
      .mockRejectedValueOnce(new Error("denied"));
    expect(await probeTrustTunnelService(denied)).toBe("unknown");
  });
});
