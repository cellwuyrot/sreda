import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { effectiveRank, ROLE_RANK } from "@/lib/groupModeration";
import { emitToUser } from "@/lib/socketEmit";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { targetUserId, channelId } = await req.json() as { targetUserId: string; channelId: string };
  if (!targetUserId || !channelId) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { groupId: true } });
  if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

  const callerMembership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: channel.groupId } },
  });
  const callerRank = callerMembership ? effectiveRank(callerMembership) : 0;
  if (callerRank < ROLE_RANK.GUIDE) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const targetMembership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: targetUserId, groupId: channel.groupId } },
  });
  const targetRank = targetMembership ? effectiveRank(targetMembership) : ROLE_RANK.MEMBER;
  if (targetRank >= callerRank) return NextResponse.json({ error: "Rank too low" }, { status: 403 });

  emitToUser(targetUserId, "voice:kick", {});
  return NextResponse.json({ ok: true });
}
