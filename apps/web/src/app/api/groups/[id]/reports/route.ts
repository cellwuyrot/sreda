import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { rankOf, RANK_MODERATOR } from "@/lib/groupModeration";

/**
 * MODERATION: жалобы участников.
 *
 * GET  — список жалоб группы. Модератор и выше.
 * POST — подать жалобу. Любой участник группы.
 *
 * Жалоба — вторая и последняя мера, доступная обычному участнику. Игнор
 * защищает его одного и ничего не сообщает никому; жалоба зовёт того, кто
 * может вмешаться. Без неё «обычный участник может только игнорировать»
 * означало бы, что позвать на помощь нельзя вообще.
 */

const REASONS = new Set(["spam", "insult", "nsfw", "flood", "scam", "other"]);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
    select: { role: true },
  });

  if (rankOf(membership?.role) < RANK_MODERATOR) {
    return NextResponse.json({ error: "Жалобы видны модераторам и выше" }, { status: 403 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  const reports = await prisma.groupReport.findMany({
    where: {
      groupId: id,
      ...(status && status !== "ALL" ? { status } : {}),
    },
    include: {
      reporter: { select: { id: true, name: true, username: true, avatar: true } },
      target: { select: { id: true, name: true, username: true, avatar: true } },
      handledBy: { select: { id: true, name: true, username: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  return NextResponse.json({ reports });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const targetId = typeof body?.targetId === "string" ? body.targetId : null;
  const messageId = typeof body?.messageId === "string" ? body.messageId : null;
  const reason = typeof body?.reason === "string" && REASONS.has(body.reason) ? body.reason : "other";
  const comment = typeof body?.comment === "string" ? body.comment.trim().slice(0, 200) : "";

  if (!targetId) {
    return NextResponse.json({ error: "targetId required" }, { status: 400 });
  }
  if (targetId === session.user.id) {
    return NextResponse.json({ error: "Нельзя пожаловаться на себя" }, { status: 400 });
  }

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
    select: { role: true },
  });
  if (!membership) {
    return NextResponse.json({ error: "Вы не состоите в этой группе" }, { status: 403 });
  }

  /* Снимок текста делается здесь, а не при разборе: к моменту, когда модератор
     откроет жалобу, нарушитель уже удалит сообщение — и карточка окажется
     пустой. Заодно проверяем, что сообщение вообще из этой группы: иначе
     жалобой можно было бы перетащить чужую переписку в свою группу. */
  let excerpt: string | null = null;
  let channelId: string | null = null;
  if (messageId) {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: {
        content: true,
        userId: true,
        channelId: true,
        channel: { select: { groupId: true } },
      },
    });
    if (!message || message.channel?.groupId !== id) {
      return NextResponse.json({ error: "Сообщение не найдено в этой группе" }, { status: 404 });
    }
    if (message.userId !== targetId) {
      return NextResponse.json({ error: "Сообщение принадлежит другому автору" }, { status: 400 });
    }
    excerpt = (message.content ?? "").trim().slice(0, 300) || null;
    channelId = message.channelId;
  }

  const fullReason = comment ? `${reason}: ${comment}`.slice(0, 300) : reason;

  try {
    const report = await prisma.groupReport.create({
      data: {
        groupId: id,
        reporterId: session.user.id,
        targetId,
        messageId,
        channelId,
        excerpt,
        reason: fullReason,
      },
    });
    return NextResponse.json({ ok: true, id: report.id });
  } catch {
    /* Единственная ожидаемая здесь ошибка — повторная жалоба на то же
       сообщение (уникальный индекс). Это не сбой, и пугать человека красной
       надписью незачем: для него ничего не изменилось, жалоба уже подана. */
    return NextResponse.json({ ok: true, duplicate: true });
  }
}
