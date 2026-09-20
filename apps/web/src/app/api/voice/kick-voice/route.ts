import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { effectiveRank, ROLE_RANK } from "@/lib/groupModeration";

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
  const isInChannel = (globalThis as Record<string, unknown>).__isUserInVoiceChannel;
  if (typeof isInChannel !== "function") {
    return NextResponse.json({ error: "Voice service unavailable" }, { status: 503 });
  }
  if (!(isInChannel as (channelId: string, userId: string) => boolean)(channelId, targetUserId)) {
    return NextResponse.json({ error: "Target is not in this voice channel" }, { status: 409 });
  }

  const kick = (globalThis as Record<string, unknown>).__kickVoiceUser;
  if (typeof kick !== "function") {
    return NextResponse.json({ error: "Voice service unavailable" }, { status: 503 });
  }
  if (!(kick as (channelId: string, userId: string) => boolean)(channelId, targetUserId)) {
    return NextResponse.json({ error: "Target changed voice channel" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
