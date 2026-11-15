import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { getServerSession } from "next-auth";
import { GET } from "./route";

const account = (over: Record<string, unknown> = {}) => row({
  id: "u1", role: "USER", isDeleted: false, banned: false, bannedUntil: null,
  isPremium: true, vpnAccess: false, vpnAccessUntil: null, ...over,
});

beforeEach(() => {
  vi.stubEnv("TRIOZ_TT_ENABLED", "true");
  vi.stubEnv("TRIOZ_TT_CRED_KEY", "11".repeat(32));
  vi.stubEnv("TRIOZ_TT_SYNC_KEY", "22".repeat(32));
  vi.stubEnv("TRIOZ_TT_SYNC_TOKEN_SHA256", "33".repeat(32));
  vi.stubEnv("TRIOZ_TT_HOSTNAME", "turn.trioz.ru");
  vi.stubEnv("TRIOZ_TT_GATEWAY_IPV4", "170.168.18.20");
  vi.stubEnv("TRIOZ_TT_PORT", "8443");
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: "u1" } } as never);
  prismaMock.vpnSettings.upsert.mockResolvedValue(row({ id: "default", activeProvider: "AMNEZIAWG", enabled: true }));
  prismaMock.siteConfig.findUnique.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

async function result() {
  const response = await GET();
  return { status: response.status, body: await response.json() };
}

describe("GET /api/vpn/trusttunnel", () => {
  it("shows project-wide AmneziaWG selection and does not grant a TrustTunnel profile", async () => {
    const response = await result();
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ activeProvider: "AMNEZIAWG", selected: false, available: false, eligible: false });
    expect(prismaMock.trustTunnelAccess.findUnique).not.toHaveBeenCalled();
  });

  it("reports Premium access and endpoint application without returning credentials", async () => {
    prismaMock.vpnSettings.upsert.mockResolvedValue(row({ id: "default", activeProvider: "TRUSTTUNNEL", enabled: true }));
    prismaMock.user.findUnique.mockResolvedValue(account());
    prismaMock.trustTunnelAccess.findUnique.mockResolvedValue(row({ generation: 2, disabledAt: null }));
    const response = await result();
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      activeProvider: "TRUSTTUNNEL", selected: true, available: true,
      eligible: true, enabled: true, applied: false, planLabel: "Premium",
    });
    expect(JSON.stringify(response.body)).not.toMatch(/password|config|token|secret/i);
  });

  it("reports the existing global VPN service switch as disabled", async () => {
    prismaMock.vpnSettings.upsert.mockResolvedValue(row({ id: "default", activeProvider: "TRUSTTUNNEL", enabled: false }));
    const response = await result();
    expect(response.body).toMatchObject({ selected: true, serviceEnabled: false, available: false });
    expect(prismaMock.trustTunnelAccess.findUnique).not.toHaveBeenCalled();
  });

  it("grants project ADMIN but not group administrator roles", async () => {
    prismaMock.vpnSettings.upsert.mockResolvedValue(row({ id: "default", activeProvider: "TRUSTTUNNEL", enabled: true }));
    prismaMock.user.findUnique.mockResolvedValue(account({ role: "ADMIN", isPremium: false }));
    prismaMock.trustTunnelAccess.findUnique.mockResolvedValue(null);
    expect((await result()).body).toMatchObject({ eligible: true, planLabel: "Доступ администратора проекта" });

    prismaMock.user.findUnique.mockResolvedValue(account({ role: "GROUP_ADMIN", isPremium: false }));
    expect((await result()).body).toMatchObject({ eligible: false, planLabel: "Нет активной подписки" });
  });

  it("fails closed if settings cannot be read", async () => {
    prismaMock.vpnSettings.upsert.mockRejectedValue(new Error("database unavailable"));
    const response = await result();
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ selected: false, available: false, planLabel: "Нет данных о доступе" });
  });
});
