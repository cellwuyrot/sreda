import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { emitToUsers } from "@/lib/socketEmit";
import { rateLimit } from "@/lib/rateLimit";
import { checkBan } from "@/lib/banCheck";

/**
 * POST /api/groups/[id]/transfer-ownership
 * Body: { memberId: string }
 *
 * Transfers the group to another member. The target becomes OWNER, the group
 * record's ownerId is updated and the previous owner is demoted to ADMIN so
 * they keep management rights until the new owner decides otherwise.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /* FIX-SEC: на этом роуте не было ни проверки блокировки, ни лимита, хотя
     действие необратимое: владелец группы меняется одним запросом.
     Заблокированный владелец мог раздать свои группы соучастникам. */
  const limited = await rateLimit(req, "group-transfer", { limit: 5, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id } = await params;
  const { memberId } = await req.json();

  if (!memberId || typeof memberId !== "string") {
    return NextResponse.json({ error: "memberId required" }, { status: 400 });
  }

  const group = await prisma.group.findUnique({ where: { id } });
  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  if (group.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Only the owner can transfer ownership" }, { status: 403 });
  }

  const target = await prisma.groupMember.findUnique({
    where: { id: memberId },
    include: { user: { select: { id: true, name: true, username: true } } },
  });

  if (!target || target.groupId !== id) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (target.userId === session.user.id) {
    return NextResponse.json({ error: "You are already the owner" }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.groupMember.update({ where: { id: memberId }, data: { role: "OWNER" } }),
    prisma.groupMember.update({
      where: { userId_groupId: { userId: session.user.id, groupId: id } },
      data: { role: "ADMIN" },
    }),
    prisma.group.update({ where: { id }, data: { ownerId: target.userId } }),
  ]);

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "user",
    action: "update",
    target: "Group",
    targetId: id,
    details: `Передача группы "${group.name}" пользователю @${target.user.username}`,
  });

  const members = await prisma.groupMember.findMany({ where: { groupId: id }, select: { userId: true } });
  emitToUsers(members.map((m) => m.userId), "group-updated", { id });

  return NextResponse.json({ ok: true, newOwnerId: target.userId });
}
