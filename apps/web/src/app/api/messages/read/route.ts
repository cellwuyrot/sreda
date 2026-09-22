import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { emitToChannel, emitToUser } from "@/lib/socketEmit";
import { getChannelPermissions } from "@/lib/connectPermissions";
import { markSubjectNotificationsRead } from "@/lib/createNotification";

/**
 * Один endpoint фиксирует собственный read state. Публичный receipt — отдельный
 * флаг: выключение галочек не должно возвращать пользователю собственный unread.
 * Thread адресуется threadId и никогда не двигает ChannelMember.lastRead.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const channelId = typeof body.channelId === "string" ? body.channelId : "";
  const threadId = typeof body.threadId === "string" ? body.threadId : null;
  const sendReceipt = body.sendReceipt !== false;
  const requestedIds: string[] = Array.isArray(body.messageIds)
    ? body.messageIds.filter((id: unknown): id is string => typeof id === "string").slice(0, 1000)
    : [];
  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 });

  const userId = session.user.id;
  const perm = await getChannelPermissions(userId, channelId);
  if (!perm?.canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let ids = requestedIds;
  if (threadId) {
    const parent = await prisma.message.findFirst({
      where: { id: threadId, channelId, threadId: null, deleted: false },
      select: { id: true },
    });
    if (!parent) return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    // Сервер, а не клиент, определяет полный набор ответов ветки. Поэтому даже
    // ответы вне первой загруженной страницы перестают быть unread.
    const replies = await prisma.message.findMany({
      where: { channelId, threadId, deleted: false, userId: { not: userId } },
      select: { id: true },
      take: 5000,
    });
    ids = replies.map((message) => message.id);
  } else if (ids.length > 0) {
    // Не позволяем записать receipt для чужого канала произвольным messageId.
    const valid = await prisma.message.findMany({
      where: { id: { in: ids }, channelId, threadId: null, deleted: false },
      select: { id: true },
    });
    ids = valid.map((message) => message.id);
  }

  await Promise.all(ids.map((messageId) => prisma.messageRead.upsert({
    where: { userId_messageId: { userId, messageId } },
    update: { readAt: new Date(), receiptVisible: sendReceipt },
    create: { userId, messageId, receiptVisible: sendReceipt },
  })));

  if (!threadId) {
    await prisma.channelMember.updateMany({
      where: { userId, channelId },
      data: { lastRead: new Date() },
    });
  }

  const subjectRead = await markSubjectNotificationsRead({
    userId,
    entityType: threadId ? "thread" : "channel",
    entityId: threadId ?? channelId,
    ...(threadId
      ? { legacyWhere: { entityType: "channel", entityId: channelId, link: { contains: `thread=${threadId}` } } }
      : {}),
  });

  // Публичные галочки получают участники канала только когда пользователь их
  // разрешил. Собственное channel-read всегда уходит в личную комнату и
  // синхронизирует вкладки/устройства Navbar, Mobile и Connect.
  if (sendReceipt && ids.length > 0) {
    emitToChannel(channelId, "messages-read", { userId, messageIds: ids });
  }
  emitToUser(userId, "channel-read", {
    channelId,
    userId,
    threadId,
    notificationUnreadCount: subjectRead.unreadLeft,
  });

  return NextResponse.json({ ok: true, threadId, readMessageIds: ids, unreadLeft: subjectRead.unreadLeft });
}
