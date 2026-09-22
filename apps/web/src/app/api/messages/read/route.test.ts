import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

const getChannelPermissions = vi.fn();
vi.mock("@/lib/connectPermissions", () => ({
  getChannelPermissions: (...args: unknown[]) => getChannelPermissions(...args),
}));

const emitToChannel = vi.fn();
const emitToUser = vi.fn();
vi.mock("@/lib/socketEmit", () => ({
  emitToChannel: (...args: unknown[]) => emitToChannel(...args),
  emitToUser: (...args: unknown[]) => emitToUser(...args),
}));

const markSubjectNotificationsRead = vi.fn();
vi.mock("@/lib/createNotification", () => ({
  markSubjectNotificationsRead: (...args: unknown[]) => markSubjectNotificationsRead(...args),
}));

import { getServerSession } from "next-auth";
import { POST } from "./route";

const session = vi.mocked(getServerSession);

function request(body: unknown) {
  return new Request("http://localhost/api/messages/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  session.mockResolvedValue({ user: { id: "reader" } } as never);
  getChannelPermissions.mockReset().mockResolvedValue({ canView: true });
  emitToChannel.mockReset();
  emitToUser.mockReset();
  markSubjectNotificationsRead.mockReset().mockResolvedValue({ marked: 1, unreadLeft: 0 });
  prismaMock.messageRead.upsert.mockResolvedValue(row({ id: "read" }));
  prismaMock.channelMember.updateMany.mockResolvedValue(row({ count: 1 }));
});

describe("POST /api/messages/read — lifecycle Thread", () => {
  it("помечает все ответы Thread адресно, не двигая lastRead канала, гасит subject и шлёт channel-read", async () => {
    prismaMock.message.findFirst.mockResolvedValue(row({ id: "thread-1" }));
    prismaMock.message.findMany.mockResolvedValue(row([
      { id: "reply-1" },
      { id: "reply-2" },
      { id: "reply-3" },
    ]));

    const response = await POST(request({
      channelId: "channel-1",
      threadId: "thread-1",
      messageIds: ["reply-1"],
      sendReceipt: true,
    }));

    expect(response.status).toBe(200);
    expect(prismaMock.messageRead.upsert).toHaveBeenCalledTimes(3);
    expect(prismaMock.channelMember.updateMany).not.toHaveBeenCalled();
    expect(markSubjectNotificationsRead).toHaveBeenCalledWith(expect.objectContaining({
      userId: "reader",
      entityType: "thread",
      entityId: "thread-1",
    }));
    expect(emitToChannel).toHaveBeenCalledWith("channel-1", "messages-read", {
      userId: "reader",
      messageIds: ["reply-1", "reply-2", "reply-3"],
    });
    expect(emitToUser).toHaveBeenCalledWith("reader", "channel-read", expect.objectContaining({
      channelId: "channel-1",
      userId: "reader",
      threadId: "thread-1",
      notificationUnreadCount: 0,
    }));
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      readMessageIds: ["reply-1", "reply-2", "reply-3"],
      unreadLeft: 0,
    });
  });

  it("sendReadReceipts=false сохраняет собственное прочтение, но не рассылает публичный messages-read", async () => {
    prismaMock.message.findMany.mockResolvedValue(row([{ id: "message-1" }]));

    const response = await POST(request({
      channelId: "channel-1",
      messageIds: ["message-1"],
      sendReceipt: false,
    }));

    expect(response.status).toBe(200);
    expect(prismaMock.messageRead.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ receiptVisible: false }),
      create: expect.objectContaining({ receiptVisible: false }),
    }));
    expect(prismaMock.channelMember.updateMany).toHaveBeenCalledTimes(1);
    expect(emitToChannel).not.toHaveBeenCalled();
    expect(emitToUser).toHaveBeenCalledWith("reader", "channel-read", expect.objectContaining({
      channelId: "channel-1",
      userId: "reader",
      threadId: null,
    }));
  });
});
