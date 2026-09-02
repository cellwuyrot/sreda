import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { effectiveRank, canActOn, ROLE_RANK } from "@/lib/groupModeration";

/**
 * GET /api/voice/moderation-info?channelId=xxx&targetUserId=yyy
 *
 * Возвращает полный набор прав для ПКМ-меню в голосовом канале:
 *   canKickVoice   — GUIDE+ над целью: выкинуть из канала (не из группы)
 *   canForceMute   — GUIDE+ над целью: принудительно заглушить микрофон
 *   canForceDeafen — MODERATOR+ над целью: заглушить микрофон + наушники
 *   canMove        — GUIDE+ над целью: перенести в другой голосовой канал
 *   canBan         — ADMIN+ над целью: забанить из группы
 *   voiceChannels  — список других голосовых каналов группы (для переноса)
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const channelId    = url.searchParams.get("channelId");
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

  let targetRole: string | null = null;
  let canKickVoice   = false;
  let canForceMute   = false;
  let canForceDeafen = false;
  let canMove        = false;
  let canBan         = false;

  if (targetUserId) {
    const targetMembership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: targetUserId, groupId } },
    });
    if (targetMembership) {
      targetRole = targetMembership.role;
      const canAct = canActOn(myRole, targetRole) && effectiveRank(targetMembership) < myRank;
      canKickVoice   = canAct && myRank >= ROLE_RANK.GUIDE;
      canForceMute   = canAct && myRank >= ROLE_RANK.GUIDE;
      canForceDeafen = canAct && myRank >= ROLE_RANK.MODERATOR;
      canMove        = canAct && myRank >= ROLE_RANK.GUIDE;
      canBan         = canAct && myRank >= ROLE_RANK.ADMIN;
    }
  }

  // Список других голосовых каналов в группе (нужен для «Перенести в канал»)
  let voiceChannels: Array<{ id: string; name: string }> = [];
  if (canMove) {
    voiceChannels = await prisma.channel.findMany({
      where: { groupId, type: "VOICE", id: { not: channelId } },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });
  }

  return NextResponse.json({
    groupId,
    myRole,
    myRank,
    targetRole,
    canKickVoice,
    canForceMute,
    canForceDeafen,
    canMove,
    canBan,
    voiceChannels,
    // Обратная совместимость
    canKick: canKickVoice,
  });
}
