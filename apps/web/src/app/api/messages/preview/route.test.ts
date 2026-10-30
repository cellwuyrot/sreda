import { beforeEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock as db, row } from "@/test/prismaMock";
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/connectPermissions", () => ({ getChannelPermissions: vi.fn() }));
vi.mock("@/lib/businessChat", () => ({
  isStaffRole: (role: string) => role === "ADMIN",
  businessAudience: vi.fn(async () => ["customer", "staff"]),
}));
vi.mock("@/lib/socketEmit", () => ({
  emitToChannel: vi.fn(),
  emitToUser: vi.fn(),
}));
vi.mock("@/lib/banCheck", () => ({ checkBan: vi.fn(async () => null) }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(async () => null) }));
import { getServerSession } from "next-auth";
import { getChannelPermissions } from "@/lib/connectPermissions";
import { emitToChannel, emitToUser } from "@/lib/socketEmit";
import { GET, POST } from "./route";
function read(scope = "channel", messageId = "m1") {
  return GET(
    new NextRequest(
      `https://trioz.ru/api/messages/preview?scope=${scope}&messageId=${messageId}`,
    ),
  );
}
function write(extra = {}, origin = "https://trioz.ru") {
  return POST(
    new NextRequest("https://trioz.ru/api/messages/preview", {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "channel",
        messageId: "m1",
        action: "personal",
        value: true,
        ...extra,
      }),
    }),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXTAUTH_URL", "https://trioz.ru");
  vi.mocked(getServerSession).mockResolvedValue({
    user: { id: "reader", role: "USER" },
  } as never);
  vi.mocked(getChannelPermissions).mockResolvedValue(
    row({ canView: true, canPost: true }),
  );
  db.message.findUnique.mockResolvedValue(
    row({
      id: "m1",
      userId: "author",
      channelId: "c1",
      deleted: false,
      previewSuppressed: false,
    }),
  );
  db.directMessage.findUnique.mockResolvedValue(
    row({
      id: "m1",
      userId: "author",
      conversationId: "d1",
      deleted: false,
      previewSuppressed: false,
    }),
  );
  db.directConversation.findUnique.mockResolvedValue(
    row({ id: "d1", kind: "PERSONAL", user1Id: "author", user2Id: "reader" }),
  );
  db.chatLinkPreviewHidden.findUnique.mockResolvedValue(null);
  db.message.updateMany.mockResolvedValue({ count: 1 });
  db.directMessage.updateMany.mockResolvedValue({ count: 1 });
});
it("requires session for reading", async () => {
  vi.mocked(getServerSession).mockResolvedValue(null);
  expect((await read()).status).toBe(401);
});
it("requires session for mutations", async () => {
  vi.mocked(getServerSession).mockResolvedValue(null);
  expect((await write()).status).toBe(401);
});
it("rejects cross origin changes", async () => {
  expect((await write({}, "https://evil.invalid")).status).toBe(403);
  expect(db.chatLinkPreviewHidden.upsert).not.toHaveBeenCalled();
});
it.each([
  { value: "true" },
  { action: "delete" },
  { scope: "user" },
  { messageId: "../x" },
])("rejects malformed mutations", async (body) =>
  expect((await write(body)).status).toBe(400),
);
it("does not leak hidden channel state", async () => {
  vi.mocked(getChannelPermissions).mockResolvedValue(row({ canView: false }));
  expect((await read()).status).toBe(404);
  expect(db.chatLinkPreviewHidden.findUnique).not.toHaveBeenCalled();
});
it("does not allow a nonparticipant into DM", async () => {
  db.directConversation.findUnique.mockResolvedValue(
    row({ kind: "PERSONAL", user1Id: "a", user2Id: "b" }),
  );
  expect((await read("dm")).status).toBe(404);
});
it("allows business staff but not unrelated users", async () => {
  db.directConversation.findUnique.mockResolvedValue(
    row({ kind: "BUSINESS", user1Id: "customer", user2Id: "staff" }),
  );
  expect((await read("dm")).status).toBe(404);
  vi.mocked(getServerSession).mockResolvedValue(
    row({ user: { id: "otherstaff", role: "ADMIN" } }),
  );
  expect((await read("dm")).status).toBe(200);
});
it("reads only the current user's persisted preference", async () => {
  db.chatLinkPreviewHidden.findUnique.mockResolvedValue(
    row({ userId: "reader" }),
  );
  expect(await (await read()).json()).toEqual({
    hidden: true,
    suppressed: false,
    canSuppress: false,
  });
  expect(db.chatLinkPreviewHidden.findUnique).toHaveBeenCalledWith({
    where: {
      userId_scope_messageId: {
        userId: "reader",
        scope: "channel",
        messageId: "m1",
      },
    },
  });
});
it("personal hide never mutates someone else's message", async () => {
  expect((await write()).status).toBe(200);
  expect(db.chatLinkPreviewHidden.upsert).toHaveBeenCalled();
  expect(db.message.updateMany).not.toHaveBeenCalled();
  expect(emitToChannel).not.toHaveBeenCalled();
  expect(emitToUser).toHaveBeenCalledWith("reader", "link-preview-state", {
    scope: "channel",
    id: "m1",
    hidden: true,
  });
});
it("restores personal hide by deleting only that preference", async () => {
  expect((await write({ value: false })).status).toBe(200);
  expect(db.chatLinkPreviewHidden.deleteMany).toHaveBeenCalledWith({
    where: { userId: "reader", scope: "channel", messageId: "m1" },
  });
});
it("does not let a reader suppress everyone's card", async () => {
  expect((await write({ action: "author" })).status).toBe(403);
  expect(db.message.updateMany).not.toHaveBeenCalled();
});
it("author suppression is saved and emitted without editing text", async () => {
  vi.mocked(getServerSession).mockResolvedValue(
    row({ user: { id: "author", role: "USER" } }),
  );
  expect((await write({ action: "author" })).status).toBe(200);
  expect(db.message.updateMany).toHaveBeenCalledWith({
    where: { id: "m1", userId: "author", deleted: false },
    data: { previewSuppressed: true },
  });
  expect(emitToChannel).toHaveBeenCalledWith("c1", "link-preview-state", {
    scope: "channel",
    id: "m1",
    suppressed: true,
  });
});
it("author can restore the global preview", async () => {
  vi.mocked(getServerSession).mockResolvedValue(
    row({ user: { id: "author" } }),
  );
  await write({ action: "author", value: false });
  expect(db.message.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ data: { previewSuppressed: false } }),
  );
});
it("revoked posting rights prevent global edits", async () => {
  vi.mocked(getServerSession).mockResolvedValue(
    row({ user: { id: "author" } }),
  );
  vi.mocked(getChannelPermissions).mockResolvedValue(
    row({ canView: true, canPost: false }),
  );
  expect((await write({ action: "author" })).status).toBe(403);
});
it("secure chats never expose an automatic preview", async () => {
  db.directConversation.findUnique.mockResolvedValue(
    row({ kind: "SECURE", user1Id: "author", user2Id: "reader" }),
  );
  expect(await (await read("dm")).json()).toMatchObject({
    suppressed: true,
    canSuppress: false,
  });
});
it("deleted messages cannot be changed", async () => {
  db.message.findUnique.mockResolvedValue(row({ deleted: true }));
  expect((await write()).status).toBe(404);
});
it("DM author changes reach both participants", async () => {
  vi.mocked(getServerSession).mockResolvedValue(
    row({ user: { id: "author" } }),
  );
  expect((await write({ scope: "dm", action: "author" })).status).toBe(200);
  expect(emitToUser).toHaveBeenCalledWith(
    "reader",
    "link-preview-state",
    expect.objectContaining({ suppressed: true }),
  );
});
it("concurrent deletion returns conflict instead of false success", async () => {
  vi.mocked(getServerSession).mockResolvedValue(
    row({ user: { id: "author" } }),
  );
  db.message.updateMany.mockResolvedValue({ count: 0 });
  expect((await write({ action: "author" })).status).toBe(409);
  expect(emitToChannel).not.toHaveBeenCalled();
});
