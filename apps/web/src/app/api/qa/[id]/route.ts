import { NextRequest, NextResponse } from "next/server";


import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getChannelPermissions } from "@/lib/connectPermissions";
import { checkBan } from "@/lib/banCheck";

/**
 * FIX-SEC-ACL: доступ проверялся по членству в сообществе, а не по каналу.
 *
 * Раздел «Вопросы и ответы» живёт в канале, а канал бывает скрытым, закрытым
 * по ролям или доступным на чтение только модерации. Прежняя проверка ничего
 * этого не знала: участник сообщества читал вопросы и ответы из каналов,
 * которых у него нет в списке. Соседний маршрут answers уже считает права
 * правильно — здесь та же проверка.
 */



async function loadThread(id: string) {
  return prisma.qAThread.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, name: true, username: true, avatar: true } },
      channel: { select: { groupId: true } },
      answers: {
        include: { author: { select: { id: true, name: true, username: true, avatar: true } }, _count: { select: { votes: true } } },
        orderBy: { createdAt: "asc" },
      },
      _count: { select: { votes: true } },
    },
  });
}

// GET /api/qa/[id]
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const thread = await loadThread(id);
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const permissions = await getChannelPermissions(session.user.id, thread.channelId);
  if (!permissions?.canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // votes by current user
  const myVotes = await prisma.qAVote.findMany({
    where: {
      userId: session.user.id,
      OR: [{ threadId: id }, { answerId: { in: thread.answers.map((a) => a.id) } }],
    },
    select: { threadId: true, answerId: true },
  });

  return NextResponse.json({ thread, myVotes });
}

// PATCH /api/qa/[id]  { status }  — only author or group OWNER/MODERATOR
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать изменять статус вопросов в разделе Q&A.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id } = await params;
  const { status } = await req.json();
  if (status !== "OPEN" && status !== "RESOLVED") {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const thread = await prisma.qAThread.findUnique({
    where: { id },
    select: { authorId: true, channelId: true },
  });
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });

  /* Права канала, а не роль в сообществе: в недоступном канале нечего ни
     закрывать, ни удалять — вопроса там для человека не существует. */
  const permissions = await getChannelPermissions(session.user.id, thread.channelId);
  if (!permissions?.canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (thread.authorId !== session.user.id && !permissions.canModerate) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updated = await prisma.qAThread.update({ where: { id }, data: { status } });
  return NextResponse.json({ thread: updated });
}

// DELETE /api/qa/[id] — author or OWNER/MODERATOR
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать удалять вопросы в разделе Q&A.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id } = await params;

  const thread = await prisma.qAThread.findUnique({
    where: { id },
    select: { authorId: true, channelId: true },
  });
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });

  /* Права канала, а не роль в сообществе: в недоступном канале нечего ни
     закрывать, ни удалять — вопроса там для человека не существует. */
  const permissions = await getChannelPermissions(session.user.id, thread.channelId);
  if (!permissions?.canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (thread.authorId !== session.user.id && !permissions.canModerate) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.qAThread.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
