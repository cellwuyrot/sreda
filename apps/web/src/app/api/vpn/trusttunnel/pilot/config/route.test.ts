import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createCipheriv } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { prismaMock, row } from "@/test/prismaMock";
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/rateLimit", () => ({ isRateLimited: vi.fn().mockResolvedValue(false) }));
import { getServerSession } from "next-auth";
import { isRateLimited } from "@/lib/rateLimit";
import { POST } from "./route";
const secret = "ab".repeat(32);
const fixture = (username = `trioz_${"a".repeat(32)}`) => ({ accountId: "a1", hostname: "turn.example.com", gatewayIpv4: "192.0.2.10", port: 8443, username, password: "Z".repeat(43) });
function pack(accounts: unknown[], key = secret) {
  const iv = Buffer.alloc(12, 8); // deterministic, test fixtures only
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  cipher.setAAD(Buffer.from("trioz-trusttunnel-pilot-v1"));
  const bytes = Buffer.concat([cipher.update(JSON.stringify({ accounts })), cipher.final()]);
  return ["v1", iv.toString("base64url"), bytes.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}
const req = (origin = "https://trioz.example") => new Request("https://trioz.example/api/vpn/trusttunnel/pilot/config", { method: "POST", headers: { origin } });
beforeEach(() => {
  vi.mocked(isRateLimited).mockResolvedValue(false);
  vi.stubEnv("NEXTAUTH_URL", "https://trioz.example");
  vi.stubEnv("TRIOZ_TT_PILOT_ENABLED", "true");
  vi.stubEnv("TRIOZ_TT_PILOT_ADMIN_IDS", "a1");
  vi.stubEnv("TRIOZ_TT_PILOT_ISSUE_ENABLED", "true");
  vi.stubEnv("TRIOZ_TT_PILOT_BUNDLE_KEY", secret);
  vi.stubEnv("TRIOZ_TT_PILOT_BUNDLE", pack([fixture()]));
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: "a1", role: "ADMIN" } } as never);
  prismaMock.user.findUnique.mockResolvedValue(row({ id: "a1", role: "ADMIN", isDeleted: false, banned: false, bannedUntil: null }));
});
afterEach(() => vi.unstubAllEnvs());
describe("isolated TrustTunnel profile issuance", () => {
  it("returns current listed project admin only, with no caching and no global switch", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200); expect(res.headers.get("cache-control")).toContain("no-store");
    const { config } = await res.json();
    expect(config).toContain('skip_verification = false'); expect(config).toContain('upstream_protocol = "http2"');
    expect(config).toContain('password = "' + "Z".repeat(43) + '"');
    expect(prismaMock.vpnSettings.updateMany).not.toHaveBeenCalled();
    const args = prismaMock.auditLog.create.mock.calls[0][0];
    expect(JSON.stringify(args)).not.toContain("Z".repeat(43));
  });
  it("accepts a fixture produced by the offline sealer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trioz-pilot-interop-"));
    try {
      const run = spawnSync(process.execPath, [resolve(process.cwd(), "../../scripts/trusttunnel-pilot-seal.mjs"), dir], {
        input: JSON.stringify({ accounts: [fixture()] }), encoding: "utf8",
      });
      expect(run.status).toBe(0);
      vi.stubEnv("TRIOZ_TT_PILOT_BUNDLE_KEY", readFileSync(join(dir, "pilot-key.txt"), "utf8").trim());
      vi.stubEnv("TRIOZ_TT_PILOT_BUNDLE", readFileSync(join(dir, "pilot-bundle.txt"), "utf8").trim());
      const res = await POST(req());
      expect(res.status).toBe(200);
      expect((await res.json()).config).toContain('password = "' + "Z".repeat(43) + '"');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("requires authenticated session and same origin", async () => {
    expect((await POST(req("https://attacker.invalid"))).status).toBe(403);
    vi.mocked(getServerSession).mockResolvedValue(null);
    expect((await POST(req())).status).toBe(401);
  });
  it("requires an explicit HTTPS app origin and fails closed on auth errors", async () => {
    vi.stubEnv("NEXTAUTH_URL", "");
    expect((await POST(req())).status).toBe(503);
    vi.stubEnv("NEXTAUTH_URL", "http://trioz.example");
    expect((await POST(req("http://trioz.example"))).status).toBe(403);
    vi.stubEnv("NEXTAUTH_URL", "https://trioz.example");
    vi.mocked(getServerSession).mockRejectedValue(new Error("secret internal exception"));
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("secret internal exception");
  });
  it("rechecks DB role, deletion and ban even if session claims ADMIN", async () => {
    for (const change of [{ role: "USER" }, { isDeleted: true }, { banned: true, bannedUntil: null }]) {
      prismaMock.user.findUnique.mockResolvedValue(row({ id: "a1", role: "ADMIN", isDeleted: false, banned: false, bannedUntil: null, ...change }));
      expect((await POST(req())).status).toBe(404);
    }
  });
  it("has separate explicit issue gate and fails closed", async () => {
    vi.stubEnv("TRIOZ_TT_PILOT_ISSUE_ENABLED", "false"); expect((await POST(req())).status).toBe(503);
    vi.stubEnv("TRIOZ_TT_PILOT_ENABLED", "false"); expect((await POST(req())).status).toBe(404);
  });
  it("rejects tampered bundle and does not expose errors or secrets", async () => {
    vi.stubEnv("TRIOZ_TT_PILOT_BUNDLE_KEY", "12".repeat(32));
    const res = await POST(req()); expect(res.status).toBe(503);
    const body = await res.text(); expect(body).not.toContain("Z".repeat(43)); expect(body).not.toContain(secret);
  });
  it("cannot select or obtain another account's credentials", async () => {
    vi.stubEnv("TRIOZ_TT_PILOT_BUNDLE", pack([{ ...fixture(), accountId: "a2" }]));
    expect((await POST(req())).status).toBe(404);
  });
  it("rejects shared credentials and injected profile values", async () => {
    vi.stubEnv("TRIOZ_TT_PILOT_BUNDLE", pack([fixture(), {...fixture(), accountId: "a2"}]));
    expect((await POST(req())).status).toBe(503);
    vi.stubEnv("TRIOZ_TT_PILOT_BUNDLE", pack([fixture(), {...fixture(`trioz_${"b".repeat(32)}`), accountId: "a2"}]));
    expect((await POST(req())).status).toBe(503);
    vi.stubEnv("TRIOZ_TT_PILOT_BUNDLE", pack([{...fixture(), hostname: 'evil.test"\nskip_verification=true'}]));
    expect((await POST(req())).status).toBe(503);
  });
  it("rate limits per account and fails closed if audit fails", async () => {
    vi.mocked(isRateLimited).mockResolvedValue(true); expect((await POST(req())).status).toBe(429);
    vi.mocked(isRateLimited).mockResolvedValue(false);
    prismaMock.auditLog.create.mockRejectedValue(new Error("audit unavailable"));
    expect((await POST(req())).status).toBe(503);
  });
  it("returns no internals when DB fails", async () => {
    prismaMock.user.findUnique.mockRejectedValue(new Error("sensitive internal message"));
    const res = await POST(req()); expect(res.status).toBe(503); expect(await res.text()).not.toContain("sensitive internal message");
  });
});
