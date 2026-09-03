import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { effectiveRank, ROLE_RANK } from "@/lib/groupModeration";
import { emitToUser } from "@/lib/socketEmit";

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

  // Уведомляем саму цель (для VoiceContext — блокирует микрофон/наушники)
  emitToUser(targetUserId, deafen ? "voice:force-deafen" : "voice:force-mute", {});

  // FIX-FORCELOCK: обновляем состояние в voiceRooms и рассылаем всем участникам
  // канала обновлённый список (включая isForceMuted/isForceDeafened).
  const fn = (globalThis as Record<string, unknown>).__forceMuteUser;
  if (typeof fn === "function") {
    (fn as (channelId: string, targetUserId: string, deafen: boolean) => void)(
      channelId, targetUserId, deafen
    );
  }

  return NextResponse.json({ ok: true });
}
