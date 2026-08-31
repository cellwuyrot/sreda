import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { effectiveRank, canActOn, ROLE_RANK } from "@/lib/groupModeration";

/**
 * GET /api/voice/moderation-info?channelId=xxx&targetUserId=yyy
 * Returns group context needed for voice-channel moderation (kick/ban).
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const channelId = url.searchParams.get("channelId");
  const targetUserId = url.searchParams.get("targetUserId");

  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 });

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { groupId: true },
  });
  if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

  const groupId = channel.groupId;

  const myMembership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId } },
  });
  const myRole = myMembership?.role ?? null;
  const myRank = myMembership ? effectiveRank(myMembership) : 0;

  let targetMemberId: string | null = null;
  let targetRole: string | null = null;
  let canKick = false;
  let canBan = false;

  if (targetUserId) {
    const targetMembership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: targetUserId, groupId } },
    });
    if (targetMembership) {
      targetMemberId = targetMembership.id;
      targetRole = targetMembership.role;
      const can = canActOn(myRole, targetRole) && effectiveRank(targetMembership) < myRank;
      canKick = can && myRank >= ROLE_RANK.GUIDE;
      canBan  = can && myRank >= ROLE_RANK.GUIDE;
    }
  }

  return NextResponse.json({ groupId, myRole, myRank, targetMemberId, targetRole, canKick, canBan });
}
