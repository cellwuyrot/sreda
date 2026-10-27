import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock, row } from "@/test/prismaMock";
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: "u" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
import { POST, DELETE } from "./route";
beforeEach(() => vi.clearAllMocks());
it("old tab-closing beacon never deletes any conversation", async () => {
  expect((await POST()).status).toBe(409);
  expect(prismaMock.directConversation.deleteMany).not.toHaveBeenCalled();
  expect(prismaMock.$transaction).not.toHaveBeenCalled();
});
it("explicit deletion is scoped to a secure conversation the user belongs to", async () => {
  prismaMock.directConversation.findFirst.mockResolvedValue(row({ id: "c" }));
  prismaMock.$transaction.mockResolvedValue(row([]));
  expect((await DELETE(new NextRequest("https://test/api/dm/secure-cleanup?id=c"))).status).toBe(200);
  expect(prismaMock.directConversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "c", kind: "SECURE", OR: [{ user1Id: "u" }, { user2Id: "u" }] } }));
  expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
});
it("does not delete a foreign conversation", async () => {
  prismaMock.directConversation.findFirst.mockResolvedValue(null);
  expect((await DELETE(new NextRequest("https://test/api/dm/secure-cleanup?id=foreign"))).status).toBe(200);
  expect(prismaMock.$transaction).not.toHaveBeenCalled();
});
