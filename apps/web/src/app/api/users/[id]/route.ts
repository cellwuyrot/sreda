import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { blockUserIdentities, unblockUserIdentities } from "@/lib/identity";
import { invalidateUserAuthCache } from "@/lib/auth";
import { emitToUser, revokeAccountSession } from "@/lib/socketEmit";
import { validateUsername } from "@/lib/username";
import { rankOf, isAppRole, canAssignRole } from "@/lib/roles"; // ROLE-CORE

// ROLE-CORE: иерархия ролей живёт в @/lib/roles, локальной копии больше нет.

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

  const myRank = rankOf(session.user.role);
  const targetRank = rankOf(targetUser.role);
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

  // ROLE-FIX: раньше значение роли не проверялось вообще — в базу уходила любая
  // строка из тела запроса (роли в схеме — String, не enum), и пользователь мог
  // получить роль, которой в приложении не существует. Теперь значение
  // валидируется, а право выдачи считается по таблице assignableRolesFor:
  // ADMIN выдаёт любые роли, EDITOR — только USER и CONSULTANT.
  if (role !== undefined) {
    if (!isAppRole(role)) {
      return NextResponse.json({ error: "Неизвестная роль" }, { status: 400 });
    }
    if (!canAssignRole(session.user.role, role)) {
      return NextResponse.json({ error: "Недостаточно прав для выдачи этой роли" }, { status: 403 });
    }
  }

  // ROLE-FIX: премиум — платная функция уровня проекта, редактору не положена.
  if (isPremium !== undefined && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Только администратор управляет премиумом" }, { status: 403 });
  }

  const { id } = await params;
  const myRank = rankOf(session.user.role);
  const targetUser = await prisma.user.findUnique({ where: { id } });
  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const targetRank = rankOf(targetUser.role);
  const isSelf = session.user.id === id;

  // ROLE-FIX: было `>` — редактор мог править другого редактора (и снимать ему
  // роль), администратор — администратора. Равный ранг тоже запрещаем.
  if (!isSelf && targetRank >= myRank) {
    return NextResponse.json({ error: "Cannot modify a user with equal or higher rank" }, { status: 403 });
  }

  // Cannot promote someone to a rank higher than your own
  if (role !== undefined && !isSelf) {
    const newRank = rankOf(role as string);
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

  const myRank = rankOf(session.user.role);
  const targetRank = rankOf(targetUser.role);
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
