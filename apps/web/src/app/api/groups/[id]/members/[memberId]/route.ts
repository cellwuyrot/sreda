import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logGroupAction } from "@/lib/groupAudit";
import { emitToUsers } from "@/lib/socketEmit";
import { ROLE_RANK, effectiveRank } from "@/lib/groupModeration";
import { checkBan } from "@/lib/banCheck";

const ASSIGNABLE_ROLES = ["ADMIN", "MODERATOR", "GUIDE", "MEMBER"];

async function groupMemberIds(groupId: string): Promise<string[]> {
  const members = await prisma.groupMember.findMany({
    where: { groupId },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id, memberId } = await params;
  const { role, guidedDays } = await req.json();

  if (!role || !ASSIGNABLE_ROLES.includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  // GUIDE requires a duration (1-365 days)
  if (role === "GUIDE") {
    const days = Number(guidedDays);
    if (!days || days < 1 || days > 365) {
      return NextResponse.json({ error: "Для роли Проводник обязательно указать guidedDays (1–365)" }, { status: 400 });
    }
  }

  const myMembership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
  });
  if (!myMembership) return NextResponse.json({ error: "Not a member" }, { status: 403 });

  const myRank = effectiveRank(myMembership);
  if (myRank < ROLE_RANK.ADMIN) {
    return NextResponse.json({ error: "Only owner or admin can change roles" }, { status: 403 });
  }

  const target = await prisma.groupMember.findUnique({ where: { id: memberId } });
  if (!target || target.groupId !== id) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (target.userId === session.user.id) return NextResponse.json({ error: "Cannot change your own role" }, { status: 403 });
  if (target.role === "OWNER") return NextResponse.json({ error: "Cannot change owner role" }, { status: 403 });

  const targetRank = effectiveRank(target);
  const newRank = ROLE_RANK[role] ?? 0;

  if (targetRank >= myRank) return NextResponse.json({ error: "Cannot change role of a member of equal or higher rank" }, { status: 403 });
  if (newRank >= myRank) return NextResponse.json({ error: "Cannot assign a role equal or higher than your own" }, { status: 403 });

  let guidedUntil: Date | null = null;
  if (role === "GUIDE" && guidedDays) {
    guidedUntil = new Date(Date.now() + Number(guidedDays) * 86400000);
  }

  const updated = await prisma.groupMember.update({
    where: { id: memberId },
    data: { role, guidedUntil },
    include: { user: { select: { id: true, name: true, username: true, avatar: true } } },
  });

  const details = role === "GUIDE"
    ? `Роль: ${target.role} → GUIDE (до ${guidedUntil?.toLocaleDateString("ru-RU")})`
    : `Роль: ${target.role} → ${role}`;

  await logGroupAction({
    groupId: id,
    actorId: session.user.id,
    actorName: session.user.username || session.user.name || "user",
    action: "member.role",
    targetId: updated.user.id,
    targetName: updated.user.username || updated.user.name,
    details,
  });

  emitToUsers(await groupMemberIds(id), "group-updated", { id });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id, memberId } = await params;

  const myMembership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
  });
  if (!myMembership) return NextResponse.json({ error: "Not a member" }, { status: 403 });

  const target = await prisma.groupMember.findUnique({
    where: { id: memberId },
    include: { user: { select: { id: true, name: true, username: true } } },
  });
  if (!target || target.groupId !== id) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (target.role === "OWNER") return NextResponse.json({ error: "Cannot kick owner" }, { status: 403 });

  const myRank = effectiveRank(myMembership);
  const targetRank = effectiveRank(target);

  if (myRank <= targetRank) return NextResponse.json({ error: "Cannot kick member of equal or higher rank" }, { status: 403 });

  const memberIds = await groupMemberIds(id);
  await prisma.groupMember.delete({ where: { id: memberId } });

  await logGroupAction({
    groupId: id,
    actorId: session.user.id,
    actorName: session.user.username || session.user.name || "user",
    action: "member.kick",
    targetId: target.user.id,
    targetName: target.user.username || target.user.name,
  });

  emitToUsers(memberIds, "group-updated", { id });
  return NextResponse.json({ ok: true });
}
