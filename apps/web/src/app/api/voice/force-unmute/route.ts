import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { effectiveRank, ROLE_RANK } from "@/lib/groupModeration";
import { emitToUser } from "@/lib/socketEmit";

/**
 * POST /api/voice/force-unmute
 * Body: { targetUserId, channelId }
 *
 * Снимает принудительное заглушение ЦЕЛИКОМ — и микрофон, и наушники.
 *
 * FIX-FORCELOCK-WHOLE: раньше клиент присылал `deafen` и тем решал, что именно
 * снять. Значение он брал из своего снимка состава комнаты, а снимок устаревает:
 * человек с заглушёнными наушниками получал обратно микрофон и оставался без
 * звука — со его стороны это выглядело как поломка связи, а не как решение
 * модератора. Полумеры здесь невозможно ни объяснить, ни заметить, поэтому
 * снятие всегда полное, а нужное звание сервер определяет по СВОЕМУ состоянию:
 * снять «мик + наушники» может модератор и выше, только микрофон — проводник.
 */
type ForceLock = { muted: boolean; deafened: boolean };

/** Текущий замок из состояния сокет-сервера. */
function readLock(channelId: string, targetUserId: string): ForceLock | null {
  const fn = (globalThis as Record<string, unknown>).__voiceForceLock;
  if (typeof fn !== "function") return null;
  const lock = (fn as (channelId: string, userId: string) => ForceLock)(channelId, targetUserId);
  return lock && typeof lock === "object" ? lock : null;
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { targetUserId, channelId } = (await req.json()) as {
    targetUserId?: string;
    channelId?: string;
  };
  if (!targetUserId || !channelId) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { groupId: true } });
  if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

  const callerMembership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: channel.groupId } },
  });
  const callerRank = callerMembership ? effectiveRank(callerMembership) : 0;

  /* Замок неизвестен (сокет-сервер не отвечает) — требуем звание построже:
     ошибиться в сторону «не дали снять» безопаснее, чем в сторону «сняли то,
     на что права не было». */
  const lock = readLock(channelId, targetUserId);
  const minRank = !lock || lock.deafened ? ROLE_RANK.MODERATOR : ROLE_RANK.GUIDE;
  if (callerRank < minRank) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const targetMembership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: targetUserId, groupId: channel.groupId } },
  });
  const targetRank = targetMembership ? effectiveRank(targetMembership) : ROLE_RANK.MEMBER;
  if (targetRank >= callerRank) return NextResponse.json({ error: "Rank too low" }, { status: 403 });

  // Уведомляем саму цель (снимает блокировку и микрофона, и наушников)
  emitToUser(targetUserId, "voice:force-undeafen", {});

  // FIX-FORCELOCK: снять замок в реестре, обновить состав комнаты и разослать его
  const fn = (globalThis as Record<string, unknown>).__forceUnmuteUser;
  if (typeof fn === "function") {
    (fn as (channelId: string, targetUserId: string) => void)(channelId, targetUserId);
  }

  return NextResponse.json({ ok: true });
}
