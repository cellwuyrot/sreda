import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { emitToChannel } from "@/lib/socketEmit";
import { getChannelPermissions } from "@/lib/connectPermissions";

// FIX-SEC-IDOR: раньше все операции проверяли лишь наличие сессии — любой
// вошедший мог перечислять/создавать/голосовать/закрывать опросы в ЧУЖИХ
// каналах. Теперь доступ проверяется через getChannelPermissions.

/* GET — list polls for a channel */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const channelId = searchParams.get("channelId");
  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 });

  const perm = await getChannelPermissions(session.user.id, channelId);
  if (!perm?.canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const polls = await prisma.poll.findMany({
    where: { channelId },
    include: {
      user: { select: { id: true, name: true, avatar: true } },
      options: {
        include: {
          votes: { select: { userId: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(polls);
}

/* POST — create a poll */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { channelId, question, options, anonymous, multiple } = await req.json();

  if (!channelId || !question || !Array.isArray(options) || options.length < 2) {
    return NextResponse.json({ error: "channelId, question, and at least 2 options required" }, { status: 400 });
  }

  const perm = await getChannelPermissions(session.user.id, channelId);
  if (!perm?.canPost) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // FIX-SEC-VALIDATION: ограничения размера, чтобы нельзя было залить гигантский опрос.
  const safeQuestion = String(question).slice(0, 500);
  const safeOptions = options
    .slice(0, 20)
    .map((text: unknown) => String(text).slice(0, 200))
    .filter((t) => t.trim().length > 0);
  if (safeOptions.length < 2) {
    return NextResponse.json({ error: "at least 2 non-empty options required" }, { status: 400 });
  }

  const poll = await prisma.poll.create({
    data: {
      channelId,
      userId: session.user.id,
      question: safeQuestion,
      anonymous: !!anonymous,
      multiple: !!multiple,
      options: {
        create: safeOptions.map((text: string) => ({ text })),
      },
    },
    include: {
      user: { select: { id: true, name: true, avatar: true } },
      options: { include: { votes: { select: { userId: true } } } },
    },
  });

  return NextResponse.json(poll, { status: 201 });
}

/* PATCH — vote or close a poll */
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { pollId, optionId, action } = await req.json();

  if (action === "close") {
    const poll = await prisma.poll.findUnique({ where: { id: pollId } });
    if (!poll) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // FIX-SEC-IDOR: закрыть опрос может его автор (если ещё состоит в канале) или
    // модератор/админ группы; платформенный ADMIN — для модерации.
    const perm = await getChannelPermissions(session.user.id, poll.channelId);
    const mayClose =
      session.user.role === "ADMIN" ||
      (!!perm?.canView && (poll.userId === session.user.id || perm.canModerate));
    if (!mayClose) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await prisma.poll.update({ where: { id: pollId }, data: { closed: true } });

    // Сохраняем завершённый опрос в историю канала как текстовое сообщение с результатами
    const closedPoll = await prisma.poll.findUnique({
      where: { id: pollId },
      include: { options: { include: { _count: { select: { votes: true } } } } },
    });
    if (closedPoll) {
      const totalVotes = closedPoll.options.reduce((s, o) => s + o._count.votes, 0);
      const lines = closedPoll.options.map((o) => {
        const v = o._count.votes;
        const pct = totalVotes ? Math.round((v / totalVotes) * 100) : 0;
        return `• ${o.text} — ${v} (${pct}%)`;
      });
      const content = `📊 Опрос завершён: ${closedPoll.question}\n${lines.join("\n")}\nВсего голосов: ${totalVotes}`;
      const msg = await prisma.message.create({
        data: { content, channelId: closedPoll.channelId, userId: closedPoll.userId },
      });
      const user = await prisma.user.findUnique({
        where: { id: closedPoll.userId },
        select: { id: true, name: true, username: true, avatar: true, role: true, avatarGlowEnabled: true, avatarGlowColors: true },
      });
      emitToChannel(closedPoll.channelId, "new-message", {
        id: msg.id, content, channelId: closedPoll.channelId,
        createdAt: msg.createdAt.toISOString(), user,
        reactions: [], reads: [], replyTo: null, _count: { threadReplies: 0 },
      });
    }

    return NextResponse.json({ ok: true });
  }

  if (!optionId) return NextResponse.json({ error: "optionId required" }, { status: 400 });

  const option = await prisma.pollOption.findUnique({
    where: { id: optionId },
    include: { poll: true },
  });
  if (!option || option.poll.closed) {
    return NextResponse.json({ error: "Poll closed or not found" }, { status: 400 });
  }

  // FIX-SEC-IDOR: голосовать может только участник, которому виден канал опроса.
  const perm = await getChannelPermissions(session.user.id, option.poll.channelId);
  if (!perm?.canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // If not multiple-choice, remove previous votes on this poll
  if (!option.poll.multiple) {
    const existingOptions = await prisma.pollOption.findMany({
      where: { pollId: option.pollId },
      select: { id: true },
    });
    await prisma.pollVote.deleteMany({
      where: {
        userId: session.user.id,
        optionId: { in: existingOptions.map((o) => o.id) },
      },
    });
  }

  // Toggle vote
  const existing = await prisma.pollVote.findUnique({
    where: { optionId_userId: { optionId, userId: session.user.id } },
  });

  if (existing) {
    await prisma.pollVote.delete({ where: { id: existing.id } });
  } else {
    await prisma.pollVote.create({
      data: { optionId, userId: session.user.id },
    });
  }

  return NextResponse.json({ ok: true });
}
