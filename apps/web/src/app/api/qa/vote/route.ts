import { NextRequest, NextResponse } from "next/server";


import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkBan } from "@/lib/banCheck";



// POST /api/qa/vote  { threadId } | { answerId }  — toggles current user's upvote
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать голосовать за вопросы и ответы в разделе Q&A.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { threadId, answerId } = await req.json();
  if (!threadId && !answerId) return NextResponse.json({ error: "threadId or answerId required" }, { status: 400 });

  // resolve groupId for membership check
  let groupId: string | null = null;
  if (threadId) {
    const t = await prisma.qAThread.findUnique({ where: { id: threadId }, select: { channel: { select: { groupId: true } } } });
    groupId = t?.channel.groupId ?? null;
  } else {
    const a = await prisma.qAAnswer.findUnique({ where: { id: answerId }, select: { thread: { select: { channel: { select: { groupId: true } } } } } });
    groupId = a?.thread.channel.groupId ?? null;
  }
  if (!groupId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId } },
  });
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const existing = await prisma.qAVote.findFirst({
    where: { userId: session.user.id, threadId: threadId || null, answerId: answerId || null },
    select: { id: true },
  });

  let voted: boolean;
  if (existing) {
    await prisma.qAVote.delete({ where: { id: existing.id } });
    voted = false;
  } else {
    await prisma.qAVote.create({
      data: { userId: session.user.id, threadId: threadId || null, answerId: answerId || null },
    });
    voted = true;
  }

  const count = await prisma.qAVote.count({ where: { threadId: threadId || null, answerId: answerId || null } });
  return NextResponse.json({ voted, count });
}
