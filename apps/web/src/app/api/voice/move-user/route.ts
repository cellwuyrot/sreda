import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { effectiveRank, ROLE_RANK } from "@/lib/groupModeration";
import { emitToUser } from "@/lib/socketEmit";

/**
 * POST /api/voice/move-user
 * Body: { targetUserId, targetChannelId, groupId }
 * GUIDE+ может перенести участника ниже себя по званию в другой голосовой
 * канал того же сообщества — из меню участника или перетаскиванием.
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

  // Check that caller has GUIDE+ rank
  /* FIX-MOVERANK: сравнение шло с числом 30, а ранги в lib/groupModeration —
     это 1…4 (MEMBER…OWNER). Условие `< 30` истинно всегда, поэтому перенос
     участника в другой голосовой канал отвечал 403 и владельцу сообщества.
     Порог берётся из общей таблицы рангов — как в kick-voice и force-mute. */
  const callerMembership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId } },
  });
  const callerRank = callerMembership ? effectiveRank(callerMembership) : 0;
  if (callerRank < ROLE_RANK.GUIDE) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Check that caller outranks target
  const targetMembership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: targetUserId, groupId } },
  });
  const targetRank = targetMembership ? effectiveRank(targetMembership) : ROLE_RANK.MEMBER;
  if (targetRank >= callerRank) {
    return NextResponse.json({ error: "Cannot move a member of equal or higher rank" }, { status: 403 });
  }

  /* Уведомляем цель. Как и у принудительного заглушения, доставка идёт через
     сокет-сервер напрямую (см. __moveVoiceUser в server.ts): emitToUser из
     маршрута App Router не всегда находит io, и тогда перенос молча не
     происходил бы вовсе. Второй путь оставлен как запасной. */
  emitToUser(targetUserId, "voice:force-join", {
    channelId: targetChannelId,
    channelName: channel.name,
  });
  const fn = (globalThis as Record<string, unknown>).__moveVoiceUser;
  if (typeof fn === "function") {
    (fn as (targetUserId: string, channelId: string, channelName: string) => void)(
      targetUserId, targetChannelId, channel.name,
    );
  }

  return NextResponse.json({ ok: true });
}
