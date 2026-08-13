import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { APPEAL_ENTITY, notifyAppealStatus } from "@/lib/appealNotify";
import { markSubjectNotificationsRead } from "@/lib/createNotification";
import { logAction } from "@/lib/audit"; // ROLE-STRUCT
import { isStaffRole } from "@/lib/roles"; // ROLE-CORE

// GET /api/appeals/[id] - full appeal + message thread (author or admin)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const appeal = await prisma.appeal.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, name: true, username: true, avatar: true } },
      channel: { select: { id: true, name: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, name: true, username: true, avatar: true } } },
      },
    },
  });
  if (!appeal) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isAdmin = (session.user.role === "ADMIN" || session.user.role === "EDITOR");
  if (!isAdmin && appeal.authorId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  /* Связка с деловым чатом: у карточки должно быть видно, кто ведёт разговор и
     куда идти отвечать. Без этого администратор не знает, занята ли заявка, и
     двое отвечают одному клиенту разное. */
  const chat = await prisma.directConversation.findUnique({
    where: { appealId: id },
    select: { id: true, handlerId: true, handler: { select: { id: true, name: true } } },
  });

  /* Открытие заявки — это и есть «прочитал». Раньше уведомление гасло только от
     нажатия на него в списке уведомлений, поэтому обычный путь (перешёл в
     обращения, открыл карточку, прочитал) оставлял его непрочитанным навсегда:
     ссылка уведомления ведёт в раздел, а не в заявку, и сопоставить её с
     конкретной карточкой было нечем.

     Гасим только свои уведомления и только по этой заявке. Ошибку глотаем:
     карточка важнее, чем пометка о прочтении. */
  let unreadLeft: number | null = null;
  try {
    const result = await markSubjectNotificationsRead({
      userId: session.user.id,
      entityType: APPEAL_ENTITY,
      entityId: id,
    });
    unreadLeft = result.unreadLeft;
  } catch (err) {
    console.warn("[appeals] не удалось погасить уведомления по заявке", id, err);
  }

  return NextResponse.json({
    appeal,
    isAdmin,
    business: chat
      ? { conversationId: chat.id, handlerId: chat.handlerId, handlerName: chat.handler?.name ?? null }
      : null,
    /* Остаток непрочитанного: колокольчик обновляется этим числом сразу, без
       второго запроса и без ожидания перезагрузки страницы. */
    unreadLeft,
  });
}

// PATCH /api/appeals/[id]  { status }  (ADMIN only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN" && session.user.role !== "EDITOR") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  const data = await req.json();
  const status = (data.status || "").trim();
  if (!["OPEN", "IN_PROGRESS", "CLOSED"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const appeal = await prisma.appeal.update({ where: { id }, data: { status } });

  /* Автор за админкой не следит: без уведомления он не узнает, что обращение
     взяли в работу или закрыли. */
  try {
    await notifyAppealStatus({
      appealId: id,
      actorId: session.user.id,
      authorId: appeal.authorId,
      subject: appeal.subject,
      status,
    });
  } catch (err) {
    console.warn("[appeals] не удалось отправить уведомление о статусе", id, err);
  }

  return NextResponse.json({ appeal });
}

// ROLE-STRUCT: безвозвратное удаление обращения (ADMIN и EDITOR).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isStaffRole(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  const appeal = await prisma.appeal.findUnique({
    where: { id },
    select: { id: true, subject: true, authorId: true },
  });
  if (!appeal) return NextResponse.json({ error: "Not found" }, { status: 404 });

  /* Деловой чат ссылается на обращение (DirectConversation.appealId, unique) и
     без отвязки внешний ключ не даст удалить строку. Сам разговор удалять
     нельзя: в нём переписка и связанные оплаты, поэтому только снимаем связь.
     Всё в одной транзакции: иначе при сбое обращение осталось бы без чата. */
  await prisma.$transaction([
    prisma.directConversation.updateMany({ where: { appealId: id }, data: { appealId: null } }),
    prisma.appeal.delete({ where: { id } }),
  ]);

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "staff",
    action: "delete",
    target: "Appeal",
    targetId: id,
    details: `Безвозвратное удаление обращения «${appeal.subject}»`,
  });

  return NextResponse.json({ success: true });
}
