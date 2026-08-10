import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { notifyAppealReply } from "@/lib/appealNotify";
import { mirrorAppealMessage } from "@/lib/businessChat";
import { SOCKET_EVENTS } from "@trioz/shared";
import { emitToUser } from "@/lib/socketEmit";

// POST /api/appeals/[id]/messages  { body }
// Author or ADMIN can reply. Admin replies are flagged isAdmin=true.
// Admin replying to an OPEN appeal moves it to IN_PROGRESS.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const data = await req.json();
  const body = (data.body || "").trim();
  if (!body) return NextResponse.json({ error: "body is required" }, { status: 400 });

  const appeal = await prisma.appeal.findUnique({ where: { id } });
  if (!appeal) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isAdmin = (session.user.role === "ADMIN" || session.user.role === "EDITOR");
  if (!isAdmin && appeal.authorId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const message = await prisma.appealMessage.create({
    data: { appealId: id, authorId: session.user.id, body, isAdmin },
    include: { author: { select: { id: true, name: true, username: true, avatar: true } } },
  });

  const nextStatus = isAdmin && appeal.status === "OPEN" ? "IN_PROGRESS" : appeal.status;
  await prisma.appeal.update({ where: { id }, data: { status: nextStatus, updatedAt: new Date() } });

  /* CHAT: карточка обращения и деловой чат — одна и та же переписка. Ответ,
     написанный здесь, попадает в чат, чтобы клиенту не приходилось читать
     заявку в двух местах. Обратно сообщения из чата в карточку не переносятся:
     карточка — это очередь и история заявки, разговор живёт в чате.

     Здесь же назначается ведущий: заявку взял тот, кто первым ответил, и его
     имя видят остальные — иначе двое отвечают одному клиенту, не зная друг о
     друге.

     Обжалование блокировки чат не получает: см. lib/businessChat. Ошибку глотаем
     с записью в журнал — ответ уже сохранён, и ронять его из-за чата нельзя. */
  let conversationId: string | null = null;
  try {
    const mirrored = await mirrorAppealMessage({
      appeal: {
        id: appeal.id,
        authorId: appeal.authorId,
        subject: appeal.subject,
        body: appeal.body,
        category: appeal.category,
      },
      authorId: session.user.id,
      body,
      fromStaff: isAdmin,
    });
    if (mirrored) {
      conversationId = mirrored.conversationId;
      for (const recipientId of mirrored.recipients) {
        /* pushEnabled: false — это событие только обновляет открытый чат.
           Нативный тост поднимает уведомление ниже (notifyAppealReply), и два
           всплывающих окна на одно сообщение никому не нужны. */
        emitToUser(recipientId, SOCKET_EVENTS.DM_MESSAGE, {
          ...mirrored.message,
          pushEnabled: false,
        });
      }
    }
  } catch (err) {
    console.warn("[appeals] не удалось перенести ответ в деловой чат", id, err);
  }

  /* Уведомление противоположной стороне. Раньше его не было вовсе: ответ
     администратора автор не видел никак, пока сам не открывал обращение, а
     дополнение автора не видели администраторы. Обращение из-за этого могло
     висеть неделю. Ошибку в отправке уведомления глотаем — ответ уже записан, и
     ронять его из-за уведомления неправильно. */
  try {
    await notifyAppealReply({
      appealId: id,
      actorId: session.user.id,
      actorName: message.author.name,
      authorId: appeal.authorId,
      subject: appeal.subject,
      body,
      fromAdmin: isAdmin,
    });
  } catch (err) {
    console.warn("[appeals] не удалось отправить уведомление об ответе", id, err);
  }

  return NextResponse.json({ message, status: nextStatus, conversationId }, { status: 201 });
}
