import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getIO, emitToUser } from "@/lib/socketEmit";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { messageIds, channelId } = await req.json();
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return NextResponse.json({ error: "messageIds required" }, { status: 400 });
  }

  const userId = (session.user as { id: string }).id;
  const ids = messageIds.slice(0, 100);
  await Promise.all(
    ids.map((messageId: string) =>
      prisma.messageRead.upsert({
        where: { userId_messageId: { userId, messageId } },
        update: {},
        create: { userId, messageId },
      }).catch(() => {})
    )
  );

  // FIX-N1: продвигаем lastRead канала. Раньше здесь создавались только квитанции
  // прочтения (MessageRead), а ChannelMember.lastRead не обновлялся — поэтому
  // /api/channels/unread продолжал считать эти сообщения непрочитанными, и бейджи
  // (сайдбар, колокольчик, значок на панели задач) не гасли.
  if (channelId && typeof channelId === "string") {
    await prisma.channelMember.upsert({
      where: { userId_channelId: { userId, channelId } },
      update: { lastRead: new Date() },
      create: { userId, channelId, lastRead: new Date() },
    }).catch(() => {});
    emitToUser(userId, "channel-read", { channelId });
  }

  const io = getIO();
  if (io && channelId) {
    io.to(`channel-${channelId}`).emit("messages-read", { userId, messageIds: ids });
  }

  return NextResponse.json({ ok: true });
}
