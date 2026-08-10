import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getChannelPermissions } from "@/lib/connectPermissions";
import { checkBan } from "@/lib/banCheck";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const permission = await getChannelPermissions(session.user.id, id);
  if (!permission?.canModerate) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const channel = await prisma.channel.findUnique({
    where: { id },
    // FIX-QAACL: этот маршрут отвечает только за список «кто видит раздел»
    // (scope VIEW); права на вопросы и ответы живут в PUT /api/channels/[id].
    include: { allowedRoles: { where: { scope: "VIEW" }, include: { role: { select: { id: true, name: true, color: true } } } } },
  });
  if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  return NextResponse.json({ isRestricted: channel.isRestricted, allowedRoles: channel.allowedRoles.map((entry) => entry.role) });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Сессия на JWT не аннулируется при бане — без проверки забаненный с живым
  // токеном мог продолжать менять права доступа к каналам.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id } = await params;
  const permission = await getChannelPermissions(session.user.id, id);
  if (!permission?.canModerate) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { isRestricted, roleIds } = await req.json();
  if (isRestricted !== undefined && typeof isRestricted !== "boolean") return NextResponse.json({ error: "Некорректное значение ограничения" }, { status: 400 });
  if (roleIds !== undefined && (!Array.isArray(roleIds) || roleIds.some((value) => typeof value !== "string"))) return NextResponse.json({ error: "Некорректный список ролей" }, { status: 400 });
  if (Array.isArray(roleIds)) {
    const validRoles = await prisma.groupRole.findMany({ where: { groupId: permission.groupId, id: { in: roleIds } }, select: { id: true } });
    if (validRoles.length !== new Set(roleIds).size) return NextResponse.json({ error: "Одна или несколько ролей не принадлежат сообществу" }, { status: 400 });
  }
  await prisma.$transaction(async (tx) => {
    if (isRestricted !== undefined) await tx.channel.update({ where: { id }, data: { isRestricted } });
    if (Array.isArray(roleIds)) {
      await tx.channelRoleAccess.deleteMany({ where: { channelId: id, scope: "VIEW" } });
      if (roleIds.length) await tx.channelRoleAccess.createMany({ data: [...new Set(roleIds)].map((roleId) => ({ channelId: id, roleId, scope: "VIEW" })) });
    }
  });
  const updated = await prisma.channel.findUnique({ where: { id }, include: { allowedRoles: { where: { scope: "VIEW" }, include: { role: { select: { id: true, name: true, color: true } } } } } });
  return NextResponse.json({ isRestricted: updated?.isRestricted, allowedRoles: updated?.allowedRoles.map((entry) => entry.role) ?? [] });
}
