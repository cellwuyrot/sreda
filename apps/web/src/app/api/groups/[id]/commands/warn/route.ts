import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logGroupAction } from "@/lib/groupAudit";
import { emitToUser } from "@/lib/socketEmit";
import { effectiveRank, ROLE_RANK } from "@/lib/groupModeration";
import { checkBan } from "@/lib/banCheck";

/**
 * POST /api/groups/[id]/commands/warn
 * Body: { username: string; reason?: string }
 * Sends a 60-second ephemeral warning banner to the target user via socket.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id: groupId } = await params;
  const { username, reason } = await req.json();

  if (!username) return NextResponse.json({ error: "username required" }, { status: 400 });

  const myMembership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId } },
  });
  if (!myMembership) return NextResponse.json({ error: "Not a member" }, { status: 403 });
  const myRank = effectiveRank(myMembership);
  if (myRank < ROLE_RANK.MODERATOR) return NextResponse.json({ error: "Moderators only" }, { status: 403 });

  const targetUser = await prisma.user.findFirst({
    where: { username: username.replace(/^@/, "") },
    select: { id: true, name: true, username: true },
  });
  if (!targetUser) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });

  const targetMember = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: targetUser.id, groupId } },
  });
  if (!targetMember) return NextResponse.json({ error: "Участник не в группе" }, { status: 404 });
  if (effectiveRank(targetMember) >= myRank) {
    return NextResponse.json({ error: "Нельзя предупреждать участника равного или выше ранга" }, { status: 403 });
  }

  const from = session.user.username || session.user.name || "moderator";
  // Send socket event visible only to target user
  emitToUser(targetUser.id, "group-warn", {
    groupId,
    from,
    reason: reason?.trim() || null,
  });

  await logGroupAction({
    groupId,
    actorId: session.user.id,
    actorName: from,
    action: "member.warn",
    targetId: targetUser.id,
    targetName: targetUser.username || targetUser.name,
    details: reason?.trim() || "без причины",
  });

  return NextResponse.json({ ok: true });
}
