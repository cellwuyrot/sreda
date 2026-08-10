import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { blockUserIdentities, unblockUserIdentities } from "@/lib/identity";
import { invalidateUserAuthCache } from "@/lib/auth";
import { emitToUser, revokeAccountSession } from "@/lib/socketEmit";
import { validateUsername } from "@/lib/username";

const ROLE_RANK: Record<string, number> = {
  USER: 1,
  CONSULTANT: 2,
  EDITOR: 3,
  ADMIN: 4,
};

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { username } = await req.json();
  const validated = validateUsername(username);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const trimmed = validated.value;

  const { id } = await params;
  const targetUser = await prisma.user.findUnique({ where: { id } });
  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const myRank = ROLE_RANK[session.user.role] || 0;
  const targetRank = ROLE_RANK[targetUser.role] || 0;
  const isSelf = session.user.id === id;

  if (!isSelf && targetRank >= myRank) {
    return NextResponse.json({ error: "Cannot change username of a user with equal or higher rank" }, { status: 403 });
  }

  const existing = await prisma.user.findUnique({ where: { username: trimmed } });
  if (existing && existing.id !== id) {
    return NextResponse.json({ error: "Username already taken" }, { status: 409 });
  }

  // Кулдаун смены ника (14 дней) касается только самостоятельной смены
  // пользователем — здесь ник меняет админ/редактор, поэтому usernameChangedAt
  // намеренно НЕ обновляем: иначе принудительное переименование модератором
  // заперло бы человека от собственной смены ника ещё на две недели.
  const updated = await prisma.user.update({
    where: { id },
    data: { username: trimmed },
    select: { id: true, username: true, email: true, name: true, role: true },
  });

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "admin",
    action: "update",
    target: "User",
    targetId: id,
    details: `Изменение username на "${trimmed}"`,
  });

  return NextResponse.json(updated);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { role, banned, banReason, bannedUntil, isPremium } = await req.json();

  // FIX-EDR: назначать роли может только ADMIN — редактору остаются бан/премиум
  if (role !== undefined && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Only admin can change roles" }, { status: 403 });
  }

  const { id } = await params;
  const myRank = ROLE_RANK[session.user.role] || 0;
  const targetUser = await prisma.user.findUnique({ where: { id } });
  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const targetRank = ROLE_RANK[targetUser.role] || 0;
  const isSelf = session.user.id === id;

  // Cannot modify a user with higher rank (unless self)
  if (!isSelf && targetRank > myRank) {
    return NextResponse.json({ error: "Cannot modify a user with higher rank" }, { status: 403 });
  }

  // Cannot promote someone to a rank higher than your own
  if (role !== undefined && !isSelf) {
    const newRank = ROLE_RANK[role as string] || 0;
    if (newRank > myRank) {
      return NextResponse.json({ error: "Cannot assign a role higher than your own" }, { status: 403 });
    }
  }

  // Prevent admin from banning another admin (already covered by rank check above, kept for clarity)
  if (banned === true && targetUser.role === "ADMIN") {
    return NextResponse.json({ error: "Cannot ban an admin" }, { status: 403 });
  }

  const data: Record<string, unknown> = {};
  if (role !== undefined) data.role = role;
  if (isPremium !== undefined) data.isPremium = !!isPremium;
  if (banned !== undefined) data.banned = banned;
  if (banReason !== undefined) data.banReason = banReason;
  if (bannedUntil !== undefined) data.bannedUntil = bannedUntil ? new Date(bannedUntil) : null;

  // When unbanning, clear ban fields
  if (banned === false) {
    data.banReason = null;
    data.bannedUntil = null;
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isPremium: true,
      banned: true,
      banReason: true,
      bannedUntil: true,
    },
  });

  // The NextAuth session callback caches role/ban state briefly. Drop that
  // cache now so the target's next session refresh reflects this action.
  if (banned !== undefined || role !== undefined) invalidateUserAuthCache(id);

  // НОВОЕ: остановка учётной записи по IP и устройству (MAC): при бане
  // блокируем все известные идентификаторы пользователя, при разбане — снимаем.
  if (banned === true) {
    await blockUserIdentities(id, typeof banReason === "string" ? banReason : null);
  } else if (banned === false) {
    await unblockUserIdentities(id);
  }

  const actions: string[] = [];
  if (role !== undefined) actions.push(`роль → ${role}`);
  if (banned === true) actions.push(`бан: ${banReason || "без причины"}`);
  if (banned === false) actions.push("разбан");

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "admin",
    action: banned === true ? "ban" : banned === false ? "unban" : "update",
    target: "User",
    targetId: id,
    details: `Пользователь "${targetUser.username}": ${actions.join(", ")}`,
  });

  if (banned === true) {
    revokeAccountSession(id, {
      reason: typeof banReason === "string" ? banReason : null,
      until: bannedUntil || null,
    });
  } else if (role !== undefined) {
    // Role buttons must appear immediately without requiring a manual logout.
    emitToUser(id, "account-role-updated", { role });
  }

  return NextResponse.json(user);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  // FIX-EDR: удалять пользователей может только ADMIN
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (session.user.id === id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  const targetUser = await prisma.user.findUnique({ where: { id } });
  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const myRank = ROLE_RANK[session.user.role] || 0;
  const targetRank = ROLE_RANK[targetUser.role] || 0;
  if (targetRank >= myRank) {
    return NextResponse.json({ error: "Cannot delete a user with equal or higher rank" }, { status: 403 });
  }

  await prisma.user.delete({ where: { id } });

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "admin",
    action: "delete",
    target: "User",
    targetId: id,
    details: `Удаление пользователя "${targetUser.username}"`,
  });

  return NextResponse.json({ success: true });
}
