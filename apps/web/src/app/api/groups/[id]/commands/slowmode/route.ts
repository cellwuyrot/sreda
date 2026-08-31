import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logGroupAction } from "@/lib/groupAudit";
import { effectiveRank, ROLE_RANK } from "@/lib/groupModeration";
import { emitToChannel } from "@/lib/socketEmit";
import { checkBan } from "@/lib/banCheck";

/**
 * POST /api/groups/[id]/commands/slowmode
 * Body: { channelId: string; seconds: number }
 * Sets slow mode on the channel (0 = off).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id: groupId } = await params;
  const { channelId, seconds } = await req.json();

  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 });
  const secs = typeof seconds === "number" ? Math.max(0, Math.min(seconds, 21600)) : 0;

  const myMembership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId } },
  });
  if (!myMembership || effectiveRank(myMembership) < ROLE_RANK.MODERATOR) {
    return NextResponse.json({ error: "Moderators only" }, { status: 403 });
  }

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, groupId },
  });
  if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

  await prisma.channel.update({ where: { id: channelId }, data: { slowmode: secs } });

  emitToChannel(channelId, "channel-slowmode", { channelId, slowmode: secs });

  await logGroupAction({
    groupId,
    actorId: session.user.id,
    actorName: session.user.username || session.user.name || "mod",
    action: "settings.update",
    targetId: channelId,
    targetName: channel.name,
    details: secs === 0 ? "Слоумод выключен" : `Слоумод ${secs}сек`,
  });

  return NextResponse.json({ ok: true, slowmode: secs });
}
