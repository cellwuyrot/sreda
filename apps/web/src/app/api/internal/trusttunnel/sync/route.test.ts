import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDecipheriv, createHash } from "node:crypto";
import { prismaMock, row } from "@/test/prismaMock";
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
import { POST } from "./route";
import { TT_SYNC_AAD } from "@/lib/trustTunnelAccess";

const token = "s".repeat(48);
const syncKey = Buffer.from("22".repeat(32), "hex");
const call = (body?: unknown, auth = `Bearer ${token}`) => POST(new Request("https://trioz.example/api/internal/trusttunnel/sync",
  { method: "POST", headers: { authorization: auth }, body: body === undefined ? undefined : JSON.stringify(body) }));
function open(sealed: string) {
  const [, iv, data, tag] = sealed.split(".");
  const d = createDecipheriv("aes-256-gcm", syncKey, Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from(TT_SYNC_AAD)); d.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString());
}
const base = { role: "USER", isDeleted: false, banned: false, bannedUntil: null, isPremium: false, vpnAccess: false, vpnAccessUntil: null };

beforeEach(() => {
  vi.stubEnv("TRIOZ_TT_ENABLED", "true");
  vi.stubEnv("TRIOZ_TT_CRED_KEY", "11".repeat(32));
  vi.stubEnv("TRIOZ_TT_SYNC_KEY", "22".repeat(32));
  vi.stubEnv("TRIOZ_TT_SYNC_TOKEN_SHA256", createHash("sha256").update(token).digest("hex"));
  vi.stubEnv("TRIOZ_TT_HOSTNAME", "turn.trioz.ru");
  vi.stubEnv("TRIOZ_TT_GATEWAY_IPV4", "170.168.18.20");
  prismaMock.trustTunnelAccess.findMany.mockResolvedValue(row([
    { userId: "prem", generation: 1 }, { userId: "expired", generation: 1 }, { userId: "admin", generation: 3 }, { userId: "gone", generation: 1 }]));
  prismaMock.user.findMany.mockResolvedValue(row([
    { ...base, id: "prem", isPremium: true },
    { ...base, id: "expired", vpnAccess: true, vpnAccessUntil: new Date(Date.now() - 1000) },
    { ...base, id: "admin", role: "ADMIN" }]));
  prismaMock.siteConfig.findUnique.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("TrustTunnel endpoint sync", () => {
  it("rejects missing or wrong agent token", async () => {
    expect((await call(undefined, "Bearer nope")).status).toBe(401);
    expect((await call(undefined, "")).status).toBe(401);
  });
  it("returns only currently entitled accounts, sealed", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const { sealed } = await res.json();
    const doc = open(sealed);
    expect(doc.users).toHaveLength(2);
    expect(prismaMock.siteConfig.upsert).toHaveBeenCalled();
    expect(JSON.stringify(prismaMock.siteConfig.upsert.mock.calls)).not.toContain(doc.users[0].password);
  });
  it("revokes everybody when the feature flag is switched off", async () => {
    vi.stubEnv("TRIOZ_TT_ENABLED", "false");
    const doc = open((await (await call()).json()).sealed);
    expect(doc.users).toEqual([]);
  });
  it("accepts an acknowledgement only for an issued snapshot", async () => {
    const res = await call({ ack: { serial: 123, ok: true, digest: "a".repeat(64), error: null } });
    expect((await res.json()).ackAccepted).toBe(false);
    prismaMock.siteConfig.findUnique.mockImplementation((async (args: { where: { key: string } }) =>
      args.where.key === "trusttunnel.sync.issued" ? { key: args.where.key, value: JSON.stringify([{ serial: 123, digest: "a".repeat(64), keys: ["k:1"] }]) } : null) as never);
    const ok = await call({ ack: { serial: 123, ok: true, digest: "a".repeat(64), error: null } });
    expect((await ok.json()).ackAccepted).toBe(true);
    expect((await call({ ack: { serial: "x" } })).status).toBe(400);
  });
  it("fails closed with 503 when there are too many rows (never a partial list)", async () => {
    prismaMock.trustTunnelAccess.findMany.mockResolvedValue(row(Array.from({ length: 301 }, (_, i) => ({ userId: `u${i}`, generation: 1 }))));
    expect((await call()).status).toBe(503);
  });
});
