import { beforeEach, expect, it, vi } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: "u" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/socketEmit", () => ({ emitToUser: vi.fn() }));
vi.mock("@/lib/workspaceSnapshots", () => ({ captureSnapshot: vi.fn().mockResolvedValue(undefined) }));
import { PUT } from "./route";
import { emitToUser } from "@/lib/socketEmit";
const snapshot = { v: 3, activeId: "b", boards: [{ id: "b", name: "Board", cards: [], edges: [], view: { x: 0, y: 0, scale: 1 } }] };
function request(baseUpdatedAt?: string | null, data: unknown = snapshot) {
  return new Request("https://test/api/workspace", { method: "PUT", body: JSON.stringify({ data: JSON.stringify(data), baseUpdatedAt }) });
}
beforeEach(() => vi.mocked(emitToUser).mockClear());
it("requires a revision from old clients", async () => {
  expect((await PUT(request())).status).toBe(428);
  expect(prismaMock.workspaceState.updateMany).not.toHaveBeenCalled();
});
it("does not replace a working state with malformed input", async () => {
  expect((await PUT(request(null, { v: 3, boards: [null] }))).status).toBe(400);
  expect(prismaMock.workspaceState.create).not.toHaveBeenCalled();
});
it("uses a conditional write and rejects the losing concurrent save", async () => {
  const base = "2026-10-27T10:00:00.000Z";
  prismaMock.workspaceState.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
  const responses = await Promise.all([PUT(request(base)), PUT(request(base))]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  expect(prismaMock.workspaceState.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "u", updatedAt: new Date(base) } }));
  expect(emitToUser).toHaveBeenCalledTimes(1);
});
it("create-only null cannot overwrite an existing workspace", async () => {
  prismaMock.workspaceState.create.mockRejectedValueOnce({ code: "P2002" });
  expect((await PUT(request(null))).status).toBe(409);
  expect(emitToUser).not.toHaveBeenCalled();
});
it("returns a fresh token after successful create", async () => {
  prismaMock.workspaceState.create.mockResolvedValue(row({}));
  const response = await PUT(request(null));
  expect(response.status).toBe(200);
  expect(Number.isFinite(Date.parse((await response.json()).updatedAt))).toBe(true);
});
