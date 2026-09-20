import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { effectiveRank, ROLE_RANK } from "@/lib/groupModeration";

// POST /api/voice/force-mute
// Body: { targetUserId, channelId, deafen?: boolean }
// deafen=false -> mic only (GUIDE+)  |  deafen=true -> mic+headphones (MODERATOR+)
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { targetUserId, channelId, deafen = false } = await req.json() as {
    targetUserId: string; channelId: string; deafen?: boolean;
  };
  if (!targetUserId || !channelId) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { groupId: true } });
  if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

  const callerMembership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: channel.groupId } },
  });
  const callerRank = callerMembership ? effectiveRank(callerMembership) : 0;
  const minRank = deafen ? ROLE_RANK.MODERATOR : ROLE_RANK.GUIDE;
  if (callerRank < minRank) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  // FIX-FORCELOCK: обновляем состояние в voiceRooms и рассылаем всем участникам
  // канала обновлённый список (включая isForceMuted/isForceDeafened).
  const fn = (globalThis as Record<string, unknown>).__forceMuteUser;
  if (typeof fn === "function") {
    const applied = (fn as (channelId: string, targetUserId: string, deafen: boolean) => boolean)(
      channelId, targetUserId, deafen
    );
    if (!applied) return NextResponse.json({ error: "Target changed voice channel" }, { status: 409 });
  } else {
    return NextResponse.json({ error: "Voice service unavailable" }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
