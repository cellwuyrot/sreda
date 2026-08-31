import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logGroupAction } from "@/lib/groupAudit";
import { emitToChannel } from "@/lib/socketEmit";
import { effectiveRank, ROLE_RANK } from "@/lib/groupModeration";
import { checkBan } from "@/lib/banCheck";

/**
 * POST /api/groups/[id]/commands/clear
 * Body: { channelId: string; count: number; username?: string }
 * Deletes the last `count` messages in the channel (optionally only from `username`).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id: groupId } = await params;
  const { channelId, count, username } = await req.json();

  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 });
  const n = Math.min(Math.max(1, Number(count) || 1), 200);

  const myMembership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId } },
  });
  if (!myMembership || effectiveRank(myMembership) < ROLE_RANK.MODERATOR) {
    return NextResponse.json({ error: "Moderators only" }, { status: 403 });
  }

  const channel = await prisma.channel.findFirst({ where: { id: channelId, groupId } });
  if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

  let targetUserId: string | undefined;
  if (username) {
    const uname = username.replace(/^@/, "");
    const user = await prisma.user.findFirst({ where: { username: uname }, select: { id: true } });
    if (!user) return NextResponse.json({ error: `Пользователь @${uname} не найден` }, { status: 404 });
    targetUserId = user.id;
  }

  const where = {
    channelId,
    ...(targetUserId ? { userId: targetUserId } : {}),
  };

  const msgs = await prisma.message.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: n,
    select: { id: true },
  });

  if (msgs.length === 0) return NextResponse.json({ ok: true, deleted: 0 });

  await prisma.message.deleteMany({ where: { id: { in: msgs.map((m) => m.id) } } });

  for (const m of msgs) {
    emitToChannel(channelId, "message-deleted", { id: m.id, channelId });
  }

  await logGroupAction({
    groupId,
    actorId: session.user.id,
    actorName: session.user.username || session.user.name || "mod",
    action: "message.purge",
    targetId: channelId,
    targetName: channel.name,
    details: `Удалено ${msgs.length} сообщений${username ? ` от @${username.replace(/^@/, "")}` : ""}`,
  });

  return NextResponse.json({ ok: true, deleted: msgs.length });
}
