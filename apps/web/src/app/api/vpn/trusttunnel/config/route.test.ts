import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { prismaMock, row } from "@/test/prismaMock";
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/rateLimit", () => ({ isRateLimited: vi.fn().mockResolvedValue(false) }));
import { getServerSession } from "next-auth";
import { deriveUsername } from "@/lib/trustTunnelAccess";
import { DELETE, POST } from "./route";

const user = (over: Record<string, unknown> = {}) => row({ id: "u1", role: "USER", isDeleted: false, banned: false, bannedUntil: null,
  isPremium: false, vpnAccess: false, vpnAccessUntil: null, ...over });
const req = (body = "", origin = "https://trioz.example") =>
  new Request("https://trioz.example/api/vpn/trusttunnel/config", { method: "POST", headers: { origin }, body: body || undefined });

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_URL", "https://trioz.example");
  vi.stubEnv("TRIOZ_TT_ENABLED", "true");
  vi.stubEnv("TRIOZ_TT_CRED_KEY", "11".repeat(32));
  vi.stubEnv("TRIOZ_TT_SYNC_KEY", "22".repeat(32));
  vi.stubEnv("TRIOZ_TT_SYNC_TOKEN_SHA256", createHash("sha256").update("x".repeat(40)).digest("hex"));
  vi.stubEnv("TRIOZ_TT_HOSTNAME", "turn.trioz.ru");
  vi.stubEnv("TRIOZ_TT_GATEWAY_IPV4", "170.168.18.20");
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: "u1", username: "andy" } } as never);
  prismaMock.vpnSettings.upsert.mockResolvedValue(row({ id: "default", activeProvider: "TRUSTTUNNEL", enabled: true }));
  prismaMock.trustTunnelAccess.upsert.mockResolvedValue(row({ generation: 1 }));
  prismaMock.siteConfig.findUnique.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("TrustTunnel subscriber profile", () => {
  it("provisions an entitled Premium account but does not deliver a profile before Endpoint ACK", async () => {
    prismaMock.user.findUnique.mockResolvedValue(user({ isPremium: true }));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const data = await res.json();
    expect(data).toEqual({ applied: false });
    expect(prismaMock.trustTunnelAccess.upsert).toHaveBeenCalled();
    expect(JSON.stringify(prismaMock.auditLog.create.mock.calls)).not.toMatch(/password|secret|token/i);
  });
  it("delivers the current generated profile only after the matching Endpoint ACK", async () => {
    prismaMock.user.findUnique.mockResolvedValue(user({ isPremium: true }));
    const username = deriveUsername(Buffer.from("11".repeat(32), "hex"), "u1");
    prismaMock.siteConfig.findUnique.mockResolvedValue(row({ value: JSON.stringify({
      serial: 123, at: Date.now(), keys: [`${username}:1`], ok: true, error: null,
    }) }));
    const res = await POST(req());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.applied).toBe(true);
    expect(data.config).toMatch(/password = "[A-Za-z0-9_-]{43}"/);
  });
  it("issues to an active «Надёжное соединение» plan and to project ADMIN", async () => {
    prismaMock.user.findUnique.mockResolvedValue(user({ vpnAccess: true, vpnAccessUntil: new Date(Date.now() + 86_400_000) }));
    expect((await POST(req())).status).toBe(200);
    prismaMock.user.findUnique.mockResolvedValue(user({ role: "ADMIN" }));
    expect((await POST(req())).status).toBe(200);
  });
  it("refuses expired plans, bans, deleted accounts and plain users (group admins included)", async () => {
    for (const u of [user(), user({ vpnAccess: true, vpnAccessUntil: new Date(Date.now() - 1000) }),
      user({ isPremium: true, banned: true }), user({ isPremium: true, isDeleted: true }), user({ role: "MODERATOR" })]) {
      prismaMock.user.findUnique.mockResolvedValue(u);
      expect((await POST(req())).status).toBe(403);
    }
    expect(prismaMock.trustTunnelAccess.upsert).not.toHaveBeenCalled();
  });
  it("rotates only on explicit request and rejects foreign fields", async () => {
    prismaMock.user.findUnique.mockResolvedValue(user({ isPremium: true }));
    prismaMock.trustTunnelAccess.upsert.mockResolvedValue(row({ generation: 2 }));
    expect((await POST(req(JSON.stringify({ rotate: true })))).status).toBe(200);
    expect(prismaMock.trustTunnelAccess.upsert.mock.calls[0][0].update).toMatchObject({ generation: { increment: 1 } });
    expect((await POST(req(JSON.stringify({ userId: "victim" })))).status).toBe(400);
  });
  it("refuses issuance when the existing VPN service switch is off", async () => {
    prismaMock.vpnSettings.upsert.mockResolvedValue(row({ id: "default", activeProvider: "TRUSTTUNNEL", enabled: false }));
    prismaMock.user.findUnique.mockResolvedValue(user({ isPremium: true }));
    expect((await POST(req())).status).toBe(503);
    expect(prismaMock.trustTunnelAccess.upsert).not.toHaveBeenCalled();
  });

  it("refuses issuance when the global project provider is AmneziaWG", async () => {
    prismaMock.vpnSettings.upsert.mockResolvedValue(row({ id: "default", activeProvider: "AMNEZIAWG", enabled: true }));
    prismaMock.user.findUnique.mockResolvedValue(user({ isPremium: true }));
    expect((await POST(req())).status).toBe(503);
    expect(prismaMock.trustTunnelAccess.upsert).not.toHaveBeenCalled();
  });

  it("requires same HTTPS origin, a session and the feature flag", async () => {
    prismaMock.user.findUnique.mockResolvedValue(user({ isPremium: true }));
    expect((await POST(req("", "https://evil.example"))).status).toBe(403);
    vi.mocked(getServerSession).mockResolvedValueOnce(null as never);
    expect((await POST(req())).status).toBe(401);
    vi.stubEnv("TRIOZ_TT_ENABLED", "false");
    expect((await POST(req())).status).toBe(503);
  });
  it("lets the user switch TrustTunnel off", async () => {
    const res = await DELETE(new Request("https://trioz.example/api/vpn/trusttunnel/config", { method: "DELETE", headers: { origin: "https://trioz.example" } }));
    expect(res.status).toBe(200);
    expect(prismaMock.trustTunnelAccess.updateMany.mock.calls[0][0]).toMatchObject({ where: { userId: "u1", disabledAt: null }, data: { generation: { increment: 1 } } });
  });
});
