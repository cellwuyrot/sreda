import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkBan } from "@/lib/banCheck";
import { rateLimit } from "@/lib/rateLimit";
import { isChannelType } from "@/lib/channelModules";
import { getChannelPermissionsBatch } from "@/lib/connectPermissions";
import { validateChannelParent } from "@/lib/channelParentValidation";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const groupId = searchParams.get("groupId");

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!groupId) {
    return NextResponse.json([]);
  }

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const isAdminRole = membership.role === "OWNER" || membership.role === "ADMIN" || membership.role === "MODERATOR";

  const channels = await prisma.channel.findMany({
    // FIX-HIDDEN: модератор и выше видят все каналы, включая скрытые;
    // обычному участнику скрытые каналы не возвращаются вовсе.
    where: { groupId, ...(isAdminRole ? {} : { hidden: false }) },
    include: {
      _count: { select: { members: true, messages: true } },
      // FIX-QAACL: только список «кто видит раздел» (scope VIEW).
      allowedRoles: isAdminRole ? false : { where: { scope: "VIEW" }, select: { roleId: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Filter out restricted channels if user doesn't have the required role
  if (!isAdminRole) {
    const permissions = await getChannelPermissionsBatch(
      session.user.id,
      channels.map((channel) => channel.id),
    );
    const visible = channels.filter((channel) => permissions.get(channel.id)?.canView);

    return NextResponse.json(visible.map(({ allowedRoles: _ar, ...rest }) => rest));
  }

  return NextResponse.json(channels);
}

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "channels", { limit: 20, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { name, type, groupId, isRestricted, roleIds, parentId, postAccess, channelGroupType } = await req.json();
  if (!name || !groupId) {
    return NextResponse.json({ error: "Name and groupId required" }, { status: 400 });
  }
  if (name.length > 100) {
    return NextResponse.json({ error: "Имя канала слишком длинное (макс. 100 символов)" }, { status: 400 });
  }

  // Whitelist типов — общий с панелями (lib/channelModules.ts). Своя копия
  // здесь уже отставала от списка модулей: новый тип добавляли в интерфейс, а
  // маршрут молча подменял его на TEXT.
  const channelType = isChannelType(type) ? type : "TEXT";

  const validAccess = ["ALL", "MOD", "ADMIN"];
  const channelAccess = validAccess.includes(postAccess) ? postAccess : "ALL";

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId } },
  });

  if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // GROUP-WORKSPACE: модуль «Рабочая среда» (CANVAS) доступен во всех группах,
  // кроме главного сообщества TZ Connect.
  if (channelType === "CANVAS") {
    const group = await prisma.group.findUnique({ where: { id: groupId }, select: { isMain: true } });
    if (group?.isMain) {
      return NextResponse.json({ error: "Рабочая среда недоступна в главном сообществе" }, { status: 400 });
    }
  }

  const normalizedGroupType = channelGroupType === "VOICE" ? "VOICE" : "TEXT";

  const parentError = await validateChannelParent({
    parentId: typeof parentId === "string" && parentId ? parentId : null,
    groupId,
    channelType,
  });
  if (parentError) return NextResponse.json({ error: parentError }, { status: 400 });

  const channel = await prisma.channel.create({
    data: {
      name,
      type: channelType,
      groupId,
      isRestricted: isRestricted || false,
      postAccess: channelAccess,
      parentId: parentId || null,
      channelGroupType: channelType === "CATEGORY" ? normalizedGroupType : null,
    },
  });

  // If restricted, set allowed roles
  if (isRestricted && Array.isArray(roleIds) && roleIds.length > 0) {
    await prisma.channelRoleAccess.createMany({
      data: roleIds.map((roleId: string) => ({ channelId: channel.id, roleId })),
      skipDuplicates: true,
    });
  }

  return NextResponse.json(channel);
}
