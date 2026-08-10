import { NextRequest, NextResponse } from "next/server";


import prisma from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkBan } from "@/lib/banCheck";
import { sanitizeText } from "@/lib/sanitize";
import { getChannelPermissions } from "@/lib/connectPermissions"; // FIX-QAACL









// POST /api/qa/[id]/answers  { body }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = await rateLimit(req, "qa-answer", { limit: 30, windowMs: 60 * 1000 });
  if (limited) return limited;

  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id } = await params;
  const { body } = await req.json();
  if (!body?.trim()) return NextResponse.json({ error: "Empty answer" }, { status: 400 });
  if (body.length > 8000) return NextResponse.json({ error: "Answer too long" }, { status: 400 });

  const thread = await prisma.qAThread.findUnique({
    where: { id },
    select: { channelId: true },
  });
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // FIX-QAACL: отвечать может тот, кому это разрешено настройками раздела —
  // все участники, модерация или носители выбранных тегов.
  const perm = await getChannelPermissions(session.user.id, thread.channelId);
  if (!perm?.canView) return NextResponse.json({ error: perm?.denialReason || "Forbidden" }, { status: 403 });
  if (!perm.canAnswer) {
    return NextResponse.json({ error: "В этом разделе вам недоступны ответы" }, { status: 403 });
  }

  const answer = await prisma.qAAnswer.create({
    data: { threadId: id, authorId: session.user.id, body: sanitizeText(body) },
    include: { author: { select: { id: true, name: true, username: true, avatar: true } }, _count: { select: { votes: true } } },
  });

  return NextResponse.json({ answer });
}