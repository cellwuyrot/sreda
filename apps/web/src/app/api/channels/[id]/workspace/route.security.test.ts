import { beforeEach, expect, it, vi } from "vitest";
import { prismaMock } from "@/test/prismaMock";
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: "u" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/connectPermissions", () => ({ getChannelPermissions: vi.fn() }));
vi.mock("@/lib/socketEmit", () => ({ emitToChannel: vi.fn() }));
vi.mock("@/lib/workspaceSnapshots", () => ({ captureSnapshot: vi.fn().mockResolvedValue(undefined) }));
import { getChannelPermissions } from "@/lib/connectPermissions";
import { GET, PUT } from "./route";
const params = { params: Promise.resolve({ id: "canvas" }) };
const snapshot = { v: 3, activeId: "b", boards: [{ id: "b", name: "Board", cards: [], edges: [], view: { x: 0, y: 0, scale: 1 } }] };
function request(baseUpdatedAt?: string | null) { return new Request("https://test/api/channels/canvas/workspace", { method: "PUT", body: JSON.stringify({ data: JSON.stringify(snapshot), baseUpdatedAt }) }); }
beforeEach(() => vi.mocked(getChannelPermissions).mockResolvedValue({ canView: true, canPost: true, channelType: "CANVAS" } as never));
it("never reads a canvas denied by channel ACL", async () => {
  vi.mocked(getChannelPermissions).mockResolvedValueOnce({ canView: false, canPost: false, channelType: "CANVAS" } as never);
  expect((await GET(request(), params)).status).toBe(403);
  expect(prismaMock.channelWorkspaceState.findUnique).not.toHaveBeenCalled();
});
it("denies read-only member writes before mutation", async () => {
  vi.mocked(getChannelPermissions).mockResolvedValueOnce({ canView: true, canPost: false, channelType: "CANVAS" } as never);
  expect((await PUT(request(null), params)).status).toBe(403);
  expect(prismaMock.channelWorkspaceState.create).not.toHaveBeenCalled();
});
it("requires a revision even for authorized writers", async () => expect((await PUT(request(), params)).status).toBe(428));
it("compares channelId and updatedAt together on conflicting save", async () => {
  const revision = "2026-10-27T10:00:00.000Z";
  prismaMock.channelWorkspaceState.updateMany.mockResolvedValueOnce({ count: 0 });
  expect((await PUT(request(revision), params)).status).toBe(409);
  expect(prismaMock.channelWorkspaceState.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { channelId: "canvas", updatedAt: new Date(revision) } }));
});
