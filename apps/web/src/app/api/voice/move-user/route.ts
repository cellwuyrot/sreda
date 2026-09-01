import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { effectiveRank } from "@/lib/groupModeration";
import { emitToUser } from "@/lib/socketEmit";

/**
 * POST /api/voice/move-user
 * Body: { targetSocketId, targetUserId, targetChannelId, groupId }
 * Moderator+ can move a user to another voice channel within the same group.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { targetUserId, targetChannelId, groupId } = await req.json() as {
    targetUserId: string;
    targetChannelId: string;
    groupId: string;
  };

  if (!targetUserId || !targetChannelId || !groupId) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Verify target channel belongs to this group
  const channel = await prisma.channel.findUnique({
    where: { id: targetChannelId },
    select: { groupId: true, name: true, type: true },
  });
  if (!channel || channel.groupId !== groupId || channel.type !== "VOICE") {
    return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
  }

  // Check that caller has moderator+ rank
  const callerMembership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId } },
  });
  if (!callerMembership || effectiveRank(callerMembership) < 30) { // GUIDE rank
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Check that caller outranks target
  const targetMembership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: targetUserId, groupId } },
  });
  const targetRank = targetMembership ? effectiveRank(targetMembership) : 0;
  if (effectiveRank(callerMembership) <= targetRank) {
    return NextResponse.json({ error: "Cannot move a member of equal or higher rank" }, { status: 403 });
  }

  // Emit force-join to the target user's personal socket room
  emitToUser(targetUserId, "voice:force-join", {
    channelId: targetChannelId,
    channelName: channel.name,
  });

  return NextResponse.json({ ok: true });
}
