import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("./prisma", () => ({ default: prismaMock }));

import { computeDesiredEntries, endpointStatusFor, recordAck } from "./trustTunnelSync";
import { loadTrustTunnelSettings, deriveUsername } from "./trustTunnelAccess";

const entitled = row({
  id: "user_1", role: "USER", isDeleted: false, banned: false, bannedUntil: null,
  isPremium: true, vpnAccess: false, vpnAccessUntil: null,
});

beforeEach(() => {
  vi.stubEnv("TRIOZ_TT_ENABLED", "true");
  vi.stubEnv("TRIOZ_TT_CRED_KEY", "11".repeat(32));
  vi.stubEnv("TRIOZ_TT_SYNC_KEY", "22".repeat(32));
  vi.stubEnv("TRIOZ_TT_SYNC_TOKEN_SHA256", "33".repeat(32));
  vi.stubEnv("TRIOZ_TT_HOSTNAME", "turn.trioz.ru");
  vi.stubEnv("TRIOZ_TT_GATEWAY_IPV4", "170.168.18.20");
  vi.stubEnv("TRIOZ_TT_PORT", "8443");
});
afterEach(() => vi.unstubAllEnvs());

describe("global TrustTunnel snapshot gating", () => {
  it("sends an empty managed set when the project selects AmneziaWG", async () => {
    prismaMock.vpnSettings.upsert.mockResolvedValue(row({ id: "default", activeProvider: "AMNEZIAWG", enabled: true }));
    expect(await computeDesiredEntries(new Date())).toEqual([]);
    expect(prismaMock.trustTunnelAccess.findMany).not.toHaveBeenCalled();
  });

  it("includes currently entitled users only when TrustTunnel is globally selected", async () => {
    prismaMock.vpnSettings.upsert.mockResolvedValue(row({ id: "default", activeProvider: "TRUSTTUNNEL", enabled: true }));
    prismaMock.trustTunnelAccess.findMany.mockResolvedValue(row([{ userId: "user_1", generation: 3 }]));
    prismaMock.user.findMany.mockResolvedValue(row([entitled]));
    expect(await computeDesiredEntries(new Date())).toEqual([{ accountId: "user_1", generation: 3 }]);
  });

  it("sends an empty managed set when the existing VPN service switch is off", async () => {
    prismaMock.vpnSettings.upsert.mockResolvedValue(row({ id: "default", activeProvider: "TRUSTTUNNEL", enabled: false }));
    expect(await computeDesiredEntries(new Date())).toEqual([]);
    expect(prismaMock.trustTunnelAccess.findMany).not.toHaveBeenCalled();
  });

  it("fails closed rather than producing an empty revocation snapshot on database errors", async () => {
    prismaMock.vpnSettings.upsert.mockRejectedValue(new Error("database unavailable"));
    await expect(computeDesiredEntries(new Date())).rejects.toThrow("database unavailable");
    expect(prismaMock.trustTunnelAccess.findMany).not.toHaveBeenCalled();
  });

  it("returns an empty snapshot when the server feature flag is disabled", async () => {
    vi.stubEnv("TRIOZ_TT_ENABLED", "false");
    expect(await computeDesiredEntries(new Date())).toEqual([]);
    expect(prismaMock.vpnSettings.upsert).not.toHaveBeenCalled();
  });



  it("rejects an older successful ACK after a newer failed apply", async () => {
    const issued = [{ serial: 20, digest: "b".repeat(64), keys: ["current:2"] },
      { serial: 10, digest: "a".repeat(64), keys: ["stale:1"] }];
    prismaMock.siteConfig.findUnique
      .mockResolvedValueOnce(row({ value: JSON.stringify(issued) }))
      .mockResolvedValueOnce(row({ value: JSON.stringify({ serial: 0, at: 0, keys: [], ok: true, error: null }) }));
    expect(await recordAck({ serial: 20, ok: false, digest: "b".repeat(64), error: "apply failed" }, new Date(20_000))).toBe(true);
    expect(prismaMock.siteConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: "trusttunnel.sync.applied" },
      update: { value: expect.stringContaining('"serial":20') },
    }));

    prismaMock.siteConfig.findUnique
      .mockResolvedValueOnce(row({ value: JSON.stringify(issued) }))
      .mockResolvedValueOnce(row({ value: JSON.stringify({ serial: 20, at: 20_000, keys: [], ok: false, error: "apply failed" }) }));
    expect(await recordAck({ serial: 10, ok: true, digest: "a".repeat(64), error: null }, new Date(21_000))).toBe(false);
  });

  it("does not accept a failed endpoint ACK as proof that the current generation is applied", async () => {
    const settings = loadTrustTunnelSettings();
    const username = deriveUsername(settings.credKey, "user_1");
    prismaMock.siteConfig.findUnique.mockResolvedValue(row({ value: JSON.stringify({
      serial: 10, at: Date.now(), keys: [`${username}:4`], ok: false, error: "apply failed",
    }) }));
    const status = await endpointStatusFor(settings, "user_1", 4);
    expect(status).toMatchObject({ applied: false, agentError: true });
  });
});
