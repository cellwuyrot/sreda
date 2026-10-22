import { beforeEach, describe, it, expect, vi } from "vitest";
import { prismaMock } from "@/test/prismaMock";
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
import { getServerSession } from "next-auth";
import { GET } from "./route";
beforeEach(() => { prismaMock.auditLog.findMany.mockResolvedValue([]); });
describe("editor overview audit privacy", () => {
  it.each(["ADMIN", "EDITOR"])("%s never receives an unscoped/all-time log query", async role => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "actor", role } } as never);
    await GET();
    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 15, where: expect.objectContaining({ createdAt: expect.objectContaining({ gte: expect.any(Date) }), OR: expect.any(Array) }) }));
    const where = prismaMock.auditLog.findMany.mock.calls[0][0]!.where!;
    if (role === "EDITOR") expect(where.userId).toBe("actor");
    else expect(where.userId).toBeUndefined();
  });
  it("denies ordinary users", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { role: "USER" } } as never);
    expect((await GET()).status).toBe(403);
    expect(prismaMock.auditLog.findMany).not.toHaveBeenCalled();
  });
});
