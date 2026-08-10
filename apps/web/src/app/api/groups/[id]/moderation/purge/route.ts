import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logGroupAction } from "@/lib/groupAudit";
import { emitToChannel } from "@/lib/socketEmit";
import { canActOn, purgeScope, rankOf, RANK_MODERATOR } from "@/lib/groupModeration";
import { checkBan } from "@/lib/banCheck";

/**
 * MODERATION: массовая чистка сообщений одного участника.
 *
 * POST /api/groups/[id]/moderation/purge
 * Body: { userId: string; scope: "last10" | "last50" | "hour" | "day"; channelId?: string }
 *
 * Почему это отдельное действие, а не побочный эффект бана. Кнопку «удалить и
 * забанить» жмут в том числе по одному грубому сообщению, и человек, который
 * её нажал, не ждёт, что вместе с этим исчезнет вся переписка за сутки.
 * Необратимое массовое удаление должно требовать отдельного решения и явного
 * выбора окна — поэтому «забанить» уносит ровно то сообщение, на котором
 * вызвали меню, а чистка живёт здесь.
 *
 * Без `channelId` чистятся все каналы группы: рейд обычно идёт сразу в
 * нескольких.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать массово удалять сообщения участников группы.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : null;
  const scopeName = typeof body?.scope === "string" ? body.scope : "last10";
  const channelId = typeof body?.channelId === "string" ? body.channelId : null;

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }
  if (userId === session.user.id) {
    return NextResponse.json({ error: "Свои сообщения удаляются по одному" }, { status: 400 });
  }

  const scope = purgeScope(scopeName);
  if (!scope) {
    return NextResponse.json({ error: "Неизвестный объём чистки" }, { status: 400 });
  }

  const [mine, theirs] = await Promise.all([
    prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: session.user.id, groupId: id } },
      select: { role: true },
    }),
    prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId: id } },
      select: { role: true },
    }),
  ]);

  if (rankOf(mine?.role) < RANK_MODERATOR) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  if (!canActOn(mine?.role, theirs?.role ?? null)) {
    return NextResponse.json({ error: "Нельзя чистить сообщения участника равного или старшего ранга" }, { status: 403 });
  }

  const channels = await prisma.channel.findMany({
    where: { groupId: id, ...(channelId ? { id: channelId } : {}) },
    select: { id: true },
  });
  if (channels.length === 0) {
    return NextResponse.json({ error: "Каналы не найдены" }, { status: 404 });
  }
  const channelIds = channels.map((c) => c.id);

  /* Сначала выбираем идентификаторы, потом удаляем по ним. deleteMany не умеет
     ни сортировать, ни ограничивать количество, а «последние 10 сообщений» без
     сортировки превратились бы в «все». */
  const doomed = await prisma.message.findMany({
    where: {
      userId,
      channelId: { in: channelIds },
      ...(scope.since ? { createdAt: { gte: scope.since } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: scope.take,
    select: { id: true, channelId: true },
  });

  if (doomed.length === 0) {
    return NextResponse.json({ ok: true, deleted: 0 });
  }

  await prisma.message.deleteMany({ where: { id: { in: doomed.map((m) => m.id) } } });

  /* Клиентам сообщаем поштучно: обработчик «message-deleted» уже есть в чате,
     и заводить второе событие ради одной операции значило бы дублировать
     логику удаления на клиенте. */
  for (const m of doomed) {
    emitToChannel(m.channelId, "message-deleted", { id: m.id, channelId: m.channelId });
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, username: true },
  });

  await logGroupAction({
    groupId: id,
    actorId: session.user.id,
    actorName: session.user.username || session.user.name || "user",
    action: "message.purge",
    targetId: userId,
    targetName: target?.username || target?.name || userId,
    details: `Удалено сообщений: ${doomed.length} (${scopeName}${channelId ? ", один канал" : ", вся группа"})`,
  });

  return NextResponse.json({ ok: true, deleted: doomed.length });
}
