import { beforeEach, describe, it, expect, vi } from "vitest";
import { prismaMock } from "@/test/prismaMock";
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
import { getServerSession } from "next-auth";
import { GET } from "./route";
const call = (q = "") => GET(new Request(`http://localhost/api/users${q}`));
beforeEach(() => {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: "admin", role: "ADMIN" } } as never);
  prismaMock.user.count.mockResolvedValue(31);
  prismaMock.user.findMany.mockResolvedValue([]);
});
describe("subscription users pagination", () => {
  it("returns 15 rows per page, searching the full database", async () => {
    expect(await (await call("?page=2&perPage=15&q=Anna")).json()).toMatchObject({ page: 2, pages: 3, perPage: 15, total: 31 });
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 15, take: 15, where: { OR: expect.arrayContaining([{ email: { contains: "Anna", mode: "insensitive" } }]) } }));
  });
  it("does not search or expose email to editors", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "editor", role: "EDITOR" } } as never);
    await call("?page=1&q=Anna");
    const args = prismaMock.user.findMany.mock.calls[0][0]!;
    expect(JSON.stringify(args.where)).not.toContain("email");
    expect(args.select).not.toHaveProperty("email");
  });
  it.each(["0", "-1", "0.5", "garbage"])("invalid perPage=%s cannot produce zero-sized pages", async size => {
    expect(await (await call(`?page=0.5&perPage=${size}`)).json()).toMatchObject({ page: 1, perPage: 15 });
  });
  it("clamps page to the last available", async () => {
    expect(await (await call("?page=999&perPage=15")).json()).toMatchObject({ page: 3 });
  });
  it("preserves unpaginated legacy consumers", async () => {
    expect(await (await call()).json()).toEqual([]);
    expect(prismaMock.user.count).not.toHaveBeenCalled();
  });
});
