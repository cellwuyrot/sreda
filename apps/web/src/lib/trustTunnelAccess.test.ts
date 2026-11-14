import { describe, expect, it } from "vitest";
import { createDecipheriv, createHash } from "node:crypto";
import {
  buildSubscriberConfig, derivePassword, deriveUsername, isValidSyncToken, loadTrustTunnelSettings,
  parseSyncAck, sealDesiredState, TT_SYNC_AAD, TT_SYNC_MAX_USERS, usernamesDigest,
} from "./trustTunnelAccess";

const token = "t".repeat(48);
const env = {
  TRIOZ_TT_CRED_KEY: "11".repeat(32), TRIOZ_TT_SYNC_KEY: "22".repeat(32),
  TRIOZ_TT_SYNC_TOKEN_SHA256: createHash("sha256").update(token).digest("hex"),
  TRIOZ_TT_HOSTNAME: "turn.trioz.ru", TRIOZ_TT_GATEWAY_IPV4: "170.168.18.20", TRIOZ_TT_PORT: "8443",
};
const settings = loadTrustTunnelSettings(env);

function open(sealed: string, key = settings.syncKey) {
  const [v, iv, data, tag] = sealed.split(".");
  expect(v).toBe("v1");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from(TT_SYNC_AAD)); d.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8"));
}

describe("TrustTunnel subscriber credentials", () => {
  it("fails closed on missing or reused keys and bad endpoint values", () => {
    expect(() => loadTrustTunnelSettings({})).toThrow();
    expect(() => loadTrustTunnelSettings({ ...env, TRIOZ_TT_SYNC_KEY: env.TRIOZ_TT_CRED_KEY })).toThrow();
    expect(() => loadTrustTunnelSettings({ ...env, TRIOZ_TT_GATEWAY_IPV4: "::1" })).toThrow();
    expect(() => loadTrustTunnelSettings({ ...env, TRIOZ_TT_PORT: "70000" })).toThrow();
  });
  it("derives stable opaque usernames and generation-bound passwords", () => {
    const u = deriveUsername(settings.credKey, "user1");
    expect(u).toMatch(/^trioz_[a-f0-9]{32}$/);
    expect(u).toBe(deriveUsername(settings.credKey, "user1"));
    expect(u).not.toBe(deriveUsername(settings.credKey, "user2"));
    expect(u).not.toContain("user1");
    const p1 = derivePassword(settings.credKey, u, 1);
    expect(p1).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(derivePassword(settings.credKey, u, 2)).not.toBe(p1);
    expect(() => derivePassword(settings.credKey, u, 0)).toThrow();
    expect(() => deriveUsername(settings.credKey, "../x")).toThrow();
  });
  it("builds the strict client profile accepted by Android/Windows validators", () => {
    const cfg = buildSubscriberConfig(settings, "user1", 1);
    expect(cfg).toContain('hostname = "turn.trioz.ru"');
    expect(cfg).toContain('addresses = ["170.168.18.20:8443"]');
    expect(cfg).toContain("skip_verification = false");
  });
  it("seals the complete snapshot; only the sync key opens it", () => {
    const now = new Date(1_800_000_000_000);
    const s = sealDesiredState(settings, [{ accountId: "b", generation: 2 }, { accountId: "a", generation: 1 }], now);
    const doc = open(s.sealed);
    expect(doc.v).toBe(1); expect(doc.serial).toBe(now.getTime()); expect(doc.expiresAt).toBeGreaterThan(doc.issuedAt);
    expect(doc.users).toHaveLength(2);
    expect(doc.users.map((u: { username: string }) => u.username)).toEqual([...s.usernames]);
    expect(s.digest).toBe(usernamesDigest(s.usernames));
    expect(s.sealed).not.toContain(doc.users[0].password);
    expect(() => open(s.sealed, settings.credKey)).toThrow();
    expect(() => sealDesiredState(settings, [{ accountId: "a", generation: 1 }, { accountId: "a", generation: 1 }], now)).toThrow();
    const many = Array.from({ length: TT_SYNC_MAX_USERS + 1 }, (_, i) => ({ accountId: `u${i}`, generation: 1 }));
    expect(() => sealDesiredState(settings, many, now)).toThrow();
  });
  it("checks agent token in constant time and parses acknowledgements strictly", () => {
    expect(isValidSyncToken(settings, `Bearer ${token}`)).toBe(true);
    expect(isValidSyncToken(settings, `Bearer ${"x".repeat(48)}`)).toBe(false);
    expect(isValidSyncToken(settings, null)).toBe(false);
    expect(parseSyncAck({ serial: 5, ok: true, digest: "a".repeat(64), error: null })).toEqual({ serial: 5, ok: true, digest: "a".repeat(64), error: null });
    expect(parseSyncAck({ serial: -1, ok: true, digest: "a".repeat(64) })).toBeNull();
    expect(parseSyncAck({ serial: 5, ok: "yes", digest: "a".repeat(64) })).toBeNull();
    expect(parseSyncAck({ serial: 5, ok: false, digest: "a".repeat(64), error: "<b>restart failed</b>" })?.error).toBe("brestart failedb");
  });
});
