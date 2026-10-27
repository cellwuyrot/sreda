import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock, row } from "@/test/prismaMock";
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: "u" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/audit", () => ({ logAction: vi.fn().mockResolvedValue(undefined) }));
import { POST } from "./route";
const publicKey = { kty: "EC", crv: "P-256", x: "A".repeat(43), y: "B".repeat(43) };
function request(extra = {}) { return new NextRequest("https://test/api/e2ee", { method: "POST", body: JSON.stringify({ publicKey, ...extra }) }); }
beforeEach(() => prismaMock.user.findUnique.mockResolvedValue(row({ e2eePublicKey: "old" })));
it("requires explicit key replacement confirmation", async () => {
  expect((await POST(request())).status).toBe(409);
  expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
});
it("cannot overwrite a key changed between reading and writing", async () => {
  prismaMock.user.updateMany.mockResolvedValue({ count: 0 });
  expect((await POST(request({ confirmReplace: true }))).status).toBe(409);
  expect(prismaMock.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "u", e2eePublicKey: "old" } }));
});
it("publishes a confirmed key with compare-and-set", async () => {
  prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
  expect((await POST(request({ confirmReplace: true }))).status).toBe(200);
});
it("never accepts private material in the public directory", async () => {
  expect((await POST(request({ publicKey: { ...publicKey, d: "secret" } }))).status).toBe(400);
});
