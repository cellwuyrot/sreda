import { describe, expect, it } from "vitest";
import { isVpnProviderActive, parseVpnProvider, providerControlView, trustTunnelReadiness } from "./vpnProvider";

const configured = {
  TRIOZ_TT_ENABLED: "true",
  TRIOZ_TT_CRED_KEY: "11".repeat(32),
  TRIOZ_TT_SYNC_KEY: "22".repeat(32),
  TRIOZ_TT_SYNC_TOKEN_SHA256: "33".repeat(32),
  TRIOZ_TT_HOSTNAME: "turn.trioz.ru",
  TRIOZ_TT_GATEWAY_IPV4: "170.168.18.20",
  TRIOZ_TT_PORT: "8443",
};

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

  it("blocks TrustTunnel until the feature flag and all server settings are valid", () => {
    const missing = trustTunnelReadiness({});
    expect(missing.ready).toBe(false);
    expect(missing.checks.find((check) => check.id === "runtime-config")).toMatchObject({ status: "BLOCKED", blocking: true });
    expect(providerControlView("AMNEZIAWG", {}).trustTunnel.switchAllowed).toBe(false);
  });

  it("allows the global switch after server config is validated and does not gate on non-probed health items", () => {
    const readiness = trustTunnelReadiness(configured);
    expect(readiness.ready).toBe(true);
    expect(readiness.checks.map((check) => check.id)).toEqual([
      "runtime-config", "credentials", "endpoint-health", "turn-gateway",
      "android-client", "windows-client", "traffic-accounting",
    ]);
    expect(readiness.checks.filter((check) => check.blocking).every((check) => check.status === "READY")).toBe(true);
    expect(readiness.checks.filter((check) => !check.blocking).every((check) => check.status === "INFO")).toBe(true);
    expect(providerControlView("AMNEZIAWG", configured).trustTunnel.switchAllowed).toBe(true);
    expect(providerControlView("TRUSTTUNNEL", configured).trustTunnel.switchAllowed).toBe(false);
  });

  it("rejects malformed key and gateway configuration even when enabled", () => {
    expect(trustTunnelReadiness({ ...configured, TRIOZ_TT_SYNC_KEY: configured.TRIOZ_TT_CRED_KEY }).ready).toBe(false);
    expect(trustTunnelReadiness({ ...configured, TRIOZ_TT_GATEWAY_IPV4: "not-an-ip" }).ready).toBe(false);
  });
});
