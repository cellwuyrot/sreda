import { beforeEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock } from "@/test/prismaMock";
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
import { getServerSession } from "next-auth";
import { GET } from "./route";
const call = (q = "") => GET(new NextRequest(`http://localhost/api/admin/logs?${q}`));
beforeEach(() => {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: "admin", role: "ADMIN" } } as never);
  prismaMock.auditLog.count.mockResolvedValue(31);
  prismaMock.auditLog.findMany.mockResolvedValue([]);
});
describe("project audit API", () => {
  it.each([null, "USER", "CONSULTANT"])("denies %s", async role => {
    vi.mocked(getServerSession).mockResolvedValue(role ? { user: { id: "u", role } } as never : null);
    expect((await call()).status).toBe(403);
    expect(prismaMock.auditLog.findMany).not.toHaveBeenCalled();
  });
  it("uses fixed 15 rows, stable ordering and shared filtered count", async () => {
    const res = await call("page=2&limit=100000&action=update&userId=u");
    expect(await res.json()).toMatchObject({ page: 2, pages: 3, total: 31, limit: 15 });
    const read = prismaMock.auditLog.findMany.mock.calls[0][0]!;
    const count = prismaMock.auditLog.count.mock.calls[0][0]!;
    expect(read).toMatchObject({ skip: 15, take: 15, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    expect(read.where).toEqual(count.where);
    expect(read.where).toMatchObject({ action: "update", userId: "u", createdAt: { gte: expect.any(Date), lte: expect.any(Date) }, OR: expect.any(Array) });
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });
  it.each(["-1", "0", "0.5", "1.5", "NaN", "Infinity"])("normalizes page %s", async page => {
    expect(await (await call(`page=${page}`)).json()).toMatchObject({ page: 1 });
    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 15 }));
  });
  it("clamps out-of-range pages and handles an empty result", async () => {
    expect(await (await call("page=999999")).json()).toMatchObject({ page: 3 });
    prismaMock.auditLog.count.mockResolvedValue(0);
    expect(await (await call("page=999999")).json()).toMatchObject({ page: 1, pages: 1, total: 0 });
  });
  it("editor cannot override their own actor filter", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "editor", role: "EDITOR" } } as never);
    await call("userId=admin");
    expect(prismaMock.auditLog.count).toHaveBeenCalledWith({ where: expect.objectContaining({ userId: "editor", OR: expect.any(Array) }) });
  });
});
