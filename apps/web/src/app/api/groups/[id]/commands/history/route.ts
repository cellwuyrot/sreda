import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { effectiveRank, ROLE_RANK } from "@/lib/groupModeration";

/**
 * GET /api/groups/[id]/commands/history?username=ник
 * Returns audit entries (timeout, ban, warn, kick) for the given user in this group.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: groupId } = await params;
  const { searchParams } = new URL(req.url);
  const username = searchParams.get("username")?.replace(/^@/, "");
  if (!username) return NextResponse.json({ error: "username required" }, { status: 400 });

  const myMembership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId } },
  });
  if (!myMembership || effectiveRank(myMembership) < ROLE_RANK.MODERATOR) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const targetUser = await prisma.user.findFirst({
    where: { username },
    select: { id: true, name: true, username: true },
  });
  if (!targetUser) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });

  const HISTORY_ACTIONS = ["member.timeout", "member.untimeout", "member.warn", "member.kick",
                            "ban.create", "ban.remove", "member.role"];

  const entries = await prisma.groupAuditEntry.findMany({
    where: {
      groupId,
      targetId: targetUser.id,
      action: { in: HISTORY_ACTIONS },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // Also get current ban if any
  const ban = await prisma.groupBan.findFirst({
    where: { groupId, userId: targetUser.id },
    select: { reason: true, createdAt: true },
  });

  // Current timeout
  const member = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: targetUser.id, groupId } },
    select: { mutedUntil: true, muteReason: true },
  });

  return NextResponse.json({
    user: targetUser,
    entries,
    currentBan: ban,
    currentTimeout: member?.mutedUntil ? { until: member.mutedUntil, reason: member.muteReason } : null,
  });
}
