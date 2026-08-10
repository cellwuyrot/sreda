import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logGroupAction } from "@/lib/groupAudit";
import { emitToUsers } from "@/lib/socketEmit";
import { ROLE_RANK } from "@/lib/groupModeration";
import { checkBan } from "@/lib/banCheck";

// MODERATION: ранги — из общего модуля. Держать здесь свою копию значило бы
// заводить восьмое место, где одно и то же правило может разойтись.

// Roles that can be granted through this endpoint. OWNER is transferred via
// the dedicated /transfer-ownership route, never assigned directly.
const ASSIGNABLE_ROLES = ["ADMIN", "MODERATOR", "MEMBER"];

/** Personal room ids of every member of a group, for socket broadcasts. */
async function groupMemberIds(groupId: string): Promise<string[]> {
  const members = await prisma.groupMember.findMany({
    where: { groupId },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать менять роли участников группы.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id, memberId } = await params;
  const { role } = await req.json();

  // BUGFIX: "ADMIN" was previously missing from this list, so the admin role
  // could never be granted through the UI.
  if (!role || !ASSIGNABLE_ROLES.includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const myMembership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
  });

  if (!myMembership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const myRank = ROLE_RANK[myMembership.role] ?? 0;

  // Only the owner and group admins can change roles at all.
  if (myRank < ROLE_RANK.ADMIN) {
    return NextResponse.json({ error: "Only owner or admin can change roles" }, { status: 403 });
  }

  const target = await prisma.groupMember.findUnique({ where: { id: memberId } });
  if (!target || target.groupId !== id) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (target.userId === session.user.id) {
    return NextResponse.json({ error: "Cannot change your own role" }, { status: 403 });
  }

  if (target.role === "OWNER") {
    return NextResponse.json({ error: "Cannot change owner role" }, { status: 403 });
  }

  const targetRank = ROLE_RANK[target.role] ?? 0;
  const newRank = ROLE_RANK[role] ?? 0;

  // You may only manage members ranked below you, and only assign roles
  // ranked below yours. The owner can therefore promote up to ADMIN, while
  // an admin manages moderators/members but cannot touch other admins.
  if (targetRank >= myRank) {
    return NextResponse.json({ error: "Cannot change role of a member of equal or higher rank" }, { status: 403 });
  }
  if (newRank >= myRank) {
    return NextResponse.json({ error: "Cannot assign a role equal or higher than your own" }, { status: 403 });
  }

  const updated = await prisma.groupMember.update({
    where: { id: memberId },
    data: { role },
    include: { user: { select: { id: true, name: true, username: true, avatar: true } } },
  });

  // NEW: журнал аудита — смена роли.
  await logGroupAction({
    groupId: id,
    actorId: session.user.id,
    actorName: session.user.username || session.user.name || "user",
    action: "member.role",
    targetId: updated.user.id,
    targetName: updated.user.username || updated.user.name,
    details: `Роль: ${target.role} → ${role}`,
  });

  // Live-update member lists / permissions in every open client.
  emitToUsers(await groupMemberIds(id), "group-updated", { id });

  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать кикать участников группы.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id, memberId } = await params;

  const myMembership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
  });

  if (!myMembership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const target = await prisma.groupMember.findUnique({
    where: { id: memberId },
    include: { user: { select: { id: true, name: true, username: true } } },
  });
  if (!target || target.groupId !== id) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (target.role === "OWNER") {
    return NextResponse.json({ error: "Cannot kick owner" }, { status: 403 });
  }

  const myRank = ROLE_RANK[myMembership.role] ?? 0;
  const targetRank = ROLE_RANK[target.role] ?? 0;

  if (myRank <= targetRank) {
    return NextResponse.json({ error: "Cannot kick member of equal or higher rank" }, { status: 403 });
  }

  // Capture ids before deleting so the kicked user also gets the update.
  const memberIds = await groupMemberIds(id);

  await prisma.groupMember.delete({ where: { id: memberId } });

  // NEW: журнал аудита — исключение участника.
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
