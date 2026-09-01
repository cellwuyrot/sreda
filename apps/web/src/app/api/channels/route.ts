import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkBan } from "@/lib/banCheck";
import { rateLimit } from "@/lib/rateLimit";
import { isChannelType } from "@/lib/channelModules";

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
    const memberRecord = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: session.user.id, groupId } },
      include: { tags: { select: { roleId: true } } },
    });
    const userRoleIds = new Set(memberRecord?.tags.map((t) => t.roleId) ?? []);

    const visible = channels.filter((ch) => {
      if (!ch.isRestricted) return true;
      const allowed = (ch as typeof ch & { allowedRoles?: { roleId: string }[] }).allowedRoles;
      if (!allowed || allowed.length === 0) return true;
      return allowed.some((a) => userRoleIds.has(a.roleId));
    });

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

  if (channelType === "CATEGORY" && parentId) {
    return NextResponse.json({ error: "Category cannot have parent" }, { status: 400 });
  }

  if (parentId) {
    const parent = await prisma.channel.findUnique({
      where: { id: parentId },
      select: {
        id: true,
        type: true,
        groupId: true,
        parentId: true,
        channelGroupType: true,
        group: { select: { isMain: true, sectionsEnabled: true } },
      },
    });
    if (!parent || parent.groupId !== groupId) {
      return NextResponse.json({ error: "Invalid parent category" }, { status: 400 });
    }
    // Classic channel sidebars use CATEGORY parents. The main TZ Connect
    // «Разделы» UI intentionally uses a top-level content block (NEWS/WIKI/…)
    // as the visual parent of its list items, so allow that shape too.
    const isSectionBlock =
      !parent.parentId &&
      parent.type !== "VOICE" &&
      parent.type !== "APPEALS" &&
      (parent.group.isMain || parent.group.sectionsEnabled);
    if (parent.type !== "CATEGORY" && !isSectionBlock) {
      return NextResponse.json({ error: "Parent must be a category" }, { status: 400 });
    }
    if (parent.type === "CATEGORY") {
      const expectedType = parent.channelGroupType === "VOICE" ? "VOICE" : "TEXT";
      if (expectedType === "VOICE" && channelType !== "VOICE") {
        return NextResponse.json({ error: "Voice category can contain only voice channels" }, { status: 400 });
      }
      if (expectedType === "TEXT" && channelType === "VOICE") {
        return NextResponse.json({ error: "Text category cannot contain voice channels" }, { status: 400 });
      }
    } else if (channelType === "VOICE" || channelType === "CATEGORY" || channelType === "APPEALS") {
      return NextResponse.json({ error: "Этот тип нельзя добавить пунктом списка" }, { status: 400 });
    }
  }

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
