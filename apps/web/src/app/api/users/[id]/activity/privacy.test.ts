import { beforeEach, describe, it, expect, vi } from "vitest";
import { prismaMock } from "@/test/prismaMock";
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
import { getServerSession } from "next-auth";
import { GET } from "./route";
const call = () => GET(new Request("http://localhost/api/users/u/activity"), { params: Promise.resolve({ id: "u" }) });
beforeEach(() => {
  prismaMock.auditLog.findMany.mockResolvedValue([]);
  prismaMock.userSession.findMany.mockResolvedValue([]);
});
describe("user activity privacy", () => {
  it("filters project actions and historical login/IP lists but preserves live sessions", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { role: "ADMIN" } } as never);
    expect((await call()).status).toBe(200);
    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 15, where: expect.objectContaining({ userId: "u", OR: expect.any(Array), createdAt: expect.objectContaining({ gte: expect.any(Date) }) }) }));
    const queries = prismaMock.userSession.findMany.mock.calls;
    expect(queries[0][0]!.where).toEqual({ userId: "u", active: true });
    expect(queries[1][0]!.where).toMatchObject({ createdAt: { gte: expect.any(Date) } });
    expect(queries[2][0]!.where).toMatchObject({ lastUsed: { gte: expect.any(Date) } });
  });
  it.each(["EDITOR", "USER"])("denies %s without reading sensitive data", async role => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { role } } as never);
    expect((await call()).status).toBe(403);
    expect(prismaMock.auditLog.findMany).not.toHaveBeenCalled();
    expect(prismaMock.userSession.findMany).not.toHaveBeenCalled();
  });
});
