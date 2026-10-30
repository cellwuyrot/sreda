import { describe, it, expect } from "vitest";
import {
  sanitizeVpnHealth,
  vpnHealthView,
  VPN_HEALTH_FIELDS,
} from "./vpnNodeHealth";
const now = 1_800_000_000_000;
const ready = () => ({
  vpnHealthVersion: 1,
  vpnCheckedAtMs: now,
  ...Object.fromEntries(VPN_HEALTH_FIELDS.map((k) => [k, "ready"])),
});
describe("VPN node configuration health", () => {
  it("old agents are unknown, not healthy", () =>
    expect(vpnHealthView({ peers: 2 }, true, now).status).toBe("unknown"));
  it("heartbeat alone is not proof of healthy networking", () =>
    expect(vpnHealthView(null, true, now).status).toBe("unknown"));
  it("all configuration checks can pass without active clients", () =>
    expect(
      vpnHealthView({ ...ready(), vpnRecentPeers: 0 }, true, now).status,
    ).toBe("ready"));
  it("missing NAT is degraded even with a live agent and handshakes", () =>
    expect(
      vpnHealthView(
        { ...ready(), vpnNat: "missing", vpnRecentPeers: 2 },
        true,
        now,
      ).status,
    ).toBe("degraded"));
  it("expired sample is unknown even when heartbeat remains fresh", () =>
    expect(
      vpnHealthView({ ...ready(), vpnCheckedAtMs: now - 120001 }, true, now)
        .status,
    ).toBe("unknown"));
  it("offline or disabled agent never makes stale configuration green", () =>
    expect(vpnHealthView(ready(), false, now).status).toBe("unknown"));
  it("future timestamps are not trusted", () =>
    expect(
      vpnHealthView({ ...ready(), vpnCheckedAtMs: now + 60000 }, true, now)
        .status,
    ).toBe("unknown"));
  it("command errors are unknown, not absent rules", () =>
    expect(
      vpnHealthView({ ...ready(), vpnNat: "unknown" }, true, now).status,
    ).toBe("unknown"));
  it("drops arbitrary nested secrets and invalid types", () => {
    const result = sanitizeVpnHealth({
      ...ready(),
      vpnNat: "private key here",
      vpnError: "secret",
      vpnRecentPeers: -1,
      vpnBidirectionalPeers: Infinity,
      vpnEgress: "eth0;reboot",
      vpnSubnet: "999.0.0.0/24",
    });
    expect(result).not.toHaveProperty("vpnNat");
    expect(result).not.toHaveProperty("vpnError");
    expect(result).not.toHaveProperty("vpnEgress");
    expect(result).not.toHaveProperty("vpnSubnet");
    expect(result).not.toHaveProperty("vpnRecentPeers");
    expect(result).not.toHaveProperty("vpnBidirectionalPeers");
  });
});
