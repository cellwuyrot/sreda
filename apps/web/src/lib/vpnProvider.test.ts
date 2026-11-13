import { describe, expect, it } from "vitest";
import { isVpnProviderActive, parseVpnProvider, providerControlView, trustTunnelReadiness } from "./vpnProvider";

describe("VPN provider control", () => {
  it("treats a legacy missing provider field as AmneziaWG", () => {
    expect(parseVpnProvider(undefined)).toBe("AMNEZIAWG");
    expect(isVpnProviderActive(undefined, "AMNEZIAWG")).toBe(true);
  });

  it("fails closed for unknown configured provider values", () => {
    expect(parseVpnProvider("UNRECOGNIZED")).toBeNull();
    expect(isVpnProviderActive("UNRECOGNIZED", "AMNEZIAWG")).toBe(false);
    expect(providerControlView("UNRECOGNIZED").canRollbackToAmneziaWG).toBe(true);
  });

  it("does not report TrustTunnel ready until every actual integration gate is implemented", () => {
    const readiness = trustTunnelReadiness();
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.map((check) => check.id)).toEqual([
      "endpoint-health",
      "credentials",
      "traffic-accounting",
      "android-client",
      "windows-client",
      "turn-gateway",
    ]);
    expect(readiness.checks.every((check) => check.status === "BLOCKED")).toBe(true);
    expect(providerControlView("AMNEZIAWG").trustTunnel.switchAllowed).toBe(false);
  });
});
