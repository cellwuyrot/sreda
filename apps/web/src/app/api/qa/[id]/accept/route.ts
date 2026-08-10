import { NextRequest, NextResponse } from "next/server";


import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";



// POST /api/qa/[id]/accept  { answerId }  — thread author or OWNER/MODERATOR
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { answerId } = await req.json();

  const thread = await prisma.qAThread.findUnique({
    where: { id },
    select: { authorId: true, channel: { select: { groupId: true } } },
  });
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const member = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: thread.channel.groupId } },
    select: { role: true },
  });
  const isMod = member?.role === "OWNER" || member?.role === "ADMIN" || member?.role === "MODERATOR"; // FIX-A3
  if (thread.authorId !== session.user.id && !isMod) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // toggle: passing null/empty unaccepts
  let acceptedAnswerId: string | null = null;
  if (answerId) {
    const ans = await prisma.qAAnswer.findFirst({ where: { id: answerId, threadId: id }, select: { id: true } });
    if (!ans) return NextResponse.json({ error: "Answer not found" }, { status: 404 });
    acceptedAnswerId = answerId;
  }

  const updated = await prisma.qAThread.update({
    where: { id },
    data: { acceptedAnswerId, status: acceptedAnswerId ? "RESOLVED" : "OPEN" },
  });

  return NextResponse.json({ thread: updated });
}