import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { emitToChannel } from "@/lib/socketEmit";
import { getChannelPermissions } from "@/lib/connectPermissions";
import { hasPremium } from "@/lib/premium";
import { pinLimit } from "@/lib/premiumLimits";
import { checkBan } from "@/lib/banCheck";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать закреплять сообщения в каналах группы.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { messageId } = await req.json();
  if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      id: true, channelId: true, pinned: true,
      /* Владелец сообщества нужен для предела закреплений: это свойство
         сообщества, а не того, кто нажал кнопку. Иначе один и тот же канал
         вмещал бы разное число закреплений в зависимости от модератора. */
      channel: { select: { groupId: true, group: { select: { owner: { select: { isPremium: true, role: true } } } } } },
    },
  });
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Check admin/moderator of the community
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: message.channel.groupId } },
  });
  if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN" && membership.role !== "MODERATOR")) {
    return NextResponse.json({ error: "Только администраторы и модераторы сообщества могут закреплять сообщения" }, { status: 403 });
  }

  /* Предел проверяем только при закреплении: открепить можно всегда, иначе
     после окончания подписки лишние закреплённые остались бы навсегда. */
  if (!message.pinned) {
    const ownerPremium = hasPremium(message.channel.group?.owner);
    const limit = pinLimit(ownerPremium);
    const pinnedCount = await prisma.message.count({
      where: { channelId: message.channelId, pinned: true, deleted: false },
    });
    if (pinnedCount >= limit) {
      return NextResponse.json(
        {
          error: ownerPremium
            ? `В канале уже ${limit} закреплённых сообщений — открепите лишние.`
            : `В канале уже ${limit} закреплённых сообщений. С подпиской Premium у владельца сообщества их помещается больше.`,
        },
        { status: 403 },
      );
    }
  }

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: {
      pinned: !message.pinned,
      pinnedBy: !message.pinned ? session.user.id : null,
      pinnedAt: !message.pinned ? new Date() : null,
    },
  });

  emitToChannel(message.channelId, "message-pinned", {
    messageId,
    pinned: updated.pinned,
    pinnedBy: session.user.id,
  });

  return NextResponse.json({ pinned: updated.pinned });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const channelId = searchParams.get("channelId");
  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 });

  // FIX-SEC-IDOR: закреплённые сообщения канала может читать только участник,
  // которому канал виден (раньше проверялась лишь сессия).
  const perm = await getChannelPermissions(session.user.id, channelId);
  if (!perm?.canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const pinnedMessages = await prisma.message.findMany({
    where: { channelId, pinned: true, deleted: false },
    include: {
      user: { select: { id: true, name: true, username: true, avatar: true, role: true } },
    },
    orderBy: { pinnedAt: "desc" },
    take: 50,
  });

  return NextResponse.json(pinnedMessages);
}
