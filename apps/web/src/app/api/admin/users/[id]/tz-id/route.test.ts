import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/test/prismaMock";
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
import { getServerSession } from "next-auth";
import { GET } from "./route";
const id = "cm123actualuserid";
const run = (value = id) => GET(new Request("https://example.test/api/admin/users/x/tz-id"), { params: Promise.resolve({ id: value }) });
beforeEach(() => vi.mocked(getServerSession).mockResolvedValue({ user: { id: "admin", role: "ADMIN" } } as never));
describe("admin-only TZ ID", () => {
  it.each(["EDITOR", "USER", "CONSULTANT"])("denies %s before querying users", async role => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { role } } as never);
    const response = await run(); expect(response.status).toBe(403); expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
  it("denies anonymous", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    expect((await run()).status).toBe(401); expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
  it("returns only the real User.id and prevents caching", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id } as never);
    const response = await run(); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tzId: id });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { id }, select: { id: true } });
  });
  it("returns 404 for missing user", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null); expect((await run()).status).toBe(404);
  });
  it("rejects invalid identifiers", async () => {
    expect((await run("a".repeat(129))).status).toBe(400); expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
  it("does not expose database error details", async () => {
    prismaMock.user.findUnique.mockRejectedValue(new Error("private connection details"));
    const response = await run(); expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain("private");
  });
});
