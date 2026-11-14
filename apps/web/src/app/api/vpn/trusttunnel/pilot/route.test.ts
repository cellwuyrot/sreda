import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/trustTunnelPilotBundle", () => ({ profileForPilotAccount: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
import { getServerSession } from "next-auth";
import { GET } from "./route";
import { profileForPilotAccount } from "@/lib/trustTunnelPilotBundle";

const admin = { id: "admin_1", role: "ADMIN", isDeleted: false, banned: false, bannedUntil: null };

beforeEach(() => {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } } as never);
  prismaMock.user.findUnique.mockResolvedValue(row(admin));
  delete process.env.TRIOZ_TT_PILOT_ISSUE_ENABLED;
  delete process.env.TRIOZ_TT_PILOT_BUNDLE;
  delete process.env.TRIOZ_TT_PILOT_BUNDLE_KEY;
  vi.mocked(profileForPilotAccount).mockReset();
  delete process.env.TRIOZ_TT_PILOT_ENABLED;
  delete process.env.TRIOZ_TT_PILOT_ADMIN_IDS;
});

describe("TrustTunnel pilot eligibility endpoint", () => {
  it("denies unauthenticated requests without reading a user", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
  it("is disabled by default", async () => expect((await GET()).status).toBe(404));
  it("allows only a listed, current project admin but never claims connection readiness", async () => {
    process.env.TRIOZ_TT_PILOT_ENABLED = "true";
    process.env.TRIOZ_TT_PILOT_ADMIN_IDS = "admin_1";
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ eligible: true, connectionReady: false });
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: "admin_1" },
      select: { id: true, role: true, isDeleted: true, banned: true, bannedUntil: true },
    });
  });
  it("reports only operator-enabled account configuration, never its secret", async () => {
    process.env.TRIOZ_TT_PILOT_ENABLED = "true"; process.env.TRIOZ_TT_PILOT_ADMIN_IDS = "admin_1";
    process.env.TRIOZ_TT_PILOT_ISSUE_ENABLED = "true";
    vi.mocked(profileForPilotAccount).mockReturnValue("PRIVATE TEST PROFILE");
    const response = await GET(); const body = await response.text();
    expect(JSON.parse(body).connectionReady).toBe(true);
    expect(body).not.toContain("PRIVATE TEST PROFILE");
  });
  it("fails closed if the operator-enabled bundle is invalid", async () => {
    process.env.TRIOZ_TT_PILOT_ENABLED = "true"; process.env.TRIOZ_TT_PILOT_ADMIN_IDS = "admin_1";
    process.env.TRIOZ_TT_PILOT_ISSUE_ENABLED = "true";
    vi.mocked(profileForPilotAccount).mockImplementation(() => { throw Error("private"); });
    const response = await GET(); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private");
  });
  it("rejects stale admin session after current DB role changes", async () => {
    process.env.TRIOZ_TT_PILOT_ENABLED = "true";
    process.env.TRIOZ_TT_PILOT_ADMIN_IDS = "admin_1";
    prismaMock.user.findUnique.mockResolvedValue(row({ ...admin, role: "USER" }));
    expect((await GET()).status).toBe(404);
  });
  it("fails closed on database failure", async () => {
    prismaMock.user.findUnique.mockRejectedValue(new Error("private database detail"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database detail");
  });
});
