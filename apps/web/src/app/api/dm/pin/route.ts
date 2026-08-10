import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { canAccessConversation } from "@/lib/connectPermissions";
import { emitToUser } from "@/lib/socketEmit";
import { hasPremium } from "@/lib/premium";
import { pinLimit } from "@/lib/premiumLimits";
import { checkBan } from "@/lib/banCheck";

/**
 * Закреплённые сообщения в личной переписке.
 *
 * Маршрута не существовало вовсе: клиент дёргал `/api/dm/pin` и получал 404, а
 * закрепление держалось только в состоянии вкладки — до перезагрузки. В базе
 * полей тоже не было, они добавлены этой же правкой (см. schema.prisma и
 * миграцию dm_pins).
 *
 * Кто может закреплять: любой участник переписки. В отличие от канала здесь нет
 * ролей — беседа общая, и «модератора» в ней быть не может.
 *
 * Сколько: предел зависит от подписки того, кто закрепляет (lib/premiumLimits).
 */

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать закреплять сообщения в личных переписках.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { messageId } = await req.json();
  if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });

  const message = await prisma.directMessage.findUnique({
    where: { id: messageId },
    select: { id: true, conversationId: true, pinned: true, deleted: true },
  });
  if (!message || message.deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!(await canAccessConversation(session.user.id, message.conversationId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  /* Предел проверяем только при закреплении: снять закрепление можно всегда,
     иначе после окончания подписки лишние оказались бы «вечными». */
  if (!message.pinned) {
    const limit = pinLimit(hasPremium(session.user));
    const pinned = await prisma.directMessage.count({
      where: { conversationId: message.conversationId, pinned: true, deleted: false },
    });
    if (pinned >= limit) {
      return NextResponse.json(
        {
          error: hasPremium(session.user)
            ? `В переписке уже ${limit} закреплённых сообщений — открепите лишние.`
            : `В переписке уже ${limit} закреплённых сообщений. С подпиской Premium их помещается больше.`,
        },
        { status: 403 },
      );
    }
  }

  const updated = await prisma.directMessage.update({
    where: { id: messageId },
    data: {
      pinned: !message.pinned,
      pinnedAt: !message.pinned ? new Date() : null,
      pinnedById: !message.pinned ? session.user.id : null,
    },
    select: { id: true, pinned: true, conversationId: true },
  });

  /* Собеседник должен увидеть закрепление сразу: список закреплённых у него
     открыт в той же беседе. Кому слать — участники беседы. */
  const participants = await prisma.directConversation.findUnique({
    where: { id: updated.conversationId },
    select: { user1Id: true, user2Id: true },
  });
  for (const userId of [participants?.user1Id, participants?.user2Id]) {
    if (userId) emitToUser(userId, "dm-pinned", { messageId: updated.id, pinned: updated.pinned });
  }

  return NextResponse.json({ pinned: updated.pinned });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conversationId = req.nextUrl.searchParams.get("conversationId");
  if (!conversationId) return NextResponse.json({ error: "conversationId required" }, { status: 400 });

  if (!(await canAccessConversation(session.user.id, conversationId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const pinned = await prisma.directMessage.findMany({
    where: { conversationId, pinned: true, deleted: false },
    include: { user: { select: { id: true, name: true, username: true, avatar: true, role: true } } },
    orderBy: { pinnedAt: "desc" },
    take: 50,
  });

  return NextResponse.json(pinned);
}
