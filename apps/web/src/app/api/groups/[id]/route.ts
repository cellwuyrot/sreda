import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
/* GROUP-SKIN: оформление сообщества нормализуется на сервере. */
import { GROUP_THEME_MAX_JSON, parseGroupTheme, serializeGroupTheme } from "@/lib/groupTheme";
import { hasPremium } from "@/lib/premium";
import { logAction } from "@/lib/audit";
import { logGroupAction } from "@/lib/groupAudit";
import { emitToUsers } from "@/lib/socketEmit";
import { checkBan } from "@/lib/banCheck";
import { GROUP_MEMBER_SELECT, MEMBERS_PAGE_SIZE, groupMemberOrder, withMemberOverrides } from "@/lib/groupMemberSelect";

/** Personal room ids of every member of a group, for socket broadcasts. */
async function groupMemberIds(groupId: string): Promise<string[]> {
  const members = await prisma.groupMember.findMany({
    where: { groupId },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
  });

  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const isAdminRole = membership.role === "OWNER" || membership.role === "ADMIN" || membership.role === "MODERATOR";

  const group = await prisma.group.findUnique({
    where: { id },
    include: {
      channels: {
        include: {
          _count: { select: { messages: true, members: true } },
          // FIX-QAACL: видимость канала определяет только список scope VIEW —
          // теги, выданные на вопросы/ответы, доступа к разделу не дают.
          allowedRoles: { where: { scope: "VIEW" }, select: { roleId: true } },
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      // Снимок сообщества запрашивается при каждом его открытии, поэтому здесь
      // только первая страница участников: на сообществе в тысячу человек
      // полный список с вложенными пользователями и тегами — это мегабайты
      // JSON и тяжёлый JOIN. Имя поля прежнее (`members`), общее число рядом в
      // `membersTotal`, остальные страницы — GET /api/groups/[id]/members.
      members: {
        select: GROUP_MEMBER_SELECT,
        orderBy: groupMemberOrder(),
        take: MEMBERS_PAGE_SIZE,
      },
      owner: { select: { id: true, name: true, username: true, isPremium: true } },
      roles: {
        include: { _count: { select: { members: true } } },
        orderBy: { createdAt: "asc" },
      },
      invites: isAdminRole
        ? { orderBy: { createdAt: "desc" } }
        : false,
    },
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  // Счётчик участников: интерфейсу он нужен целиком («Участники — 1240»), а в
  // `members` теперь лежит только страница, поэтому длиной массива его не
  // посчитать. COUNT по индексу @@index([groupId]) дешёвый.
  const membersTotal = await prisma.groupMember.count({ where: { groupId: id } });

  // FIX-NEWSACL: канал с ограниченным чтением не попадает в список у тех, кому
  // читать нельзя. Проверка идёт до ветки ролей, потому что readAccess=ADMIN
  // должен скрывать канал и от модератора (он входит в isAdminRole).
  const isOwnerAdmin = membership.role === "OWNER" || membership.role === "ADMIN";
  let visibleChannels = group.channels.filter((ch) => {
    /* FIX-SRVHIDE2: скрытый канал не виден НИКОМУ, включая администрацию.
       Флаг hidden ставит выключенная в админке услуга, а фильтр ниже работал
       только для рядовых участников — владелец и администратор продолжали
       видеть раздел выключенной услуги и не понимали, применилась ли правка.
       Включать обратно в Админ ▸ Услуги — там же, где выключили. */
    if ((ch as { hidden?: boolean }).hidden) return false;
    const access = (ch as { readAccess?: string }).readAccess ?? "ALL";
    if (access === "ADMIN") return isOwnerAdmin;
    if (access === "MOD") return isAdminRole;
    return true;
  });

  // Filter restricted channels for non-admin members
  if (!isAdminRole) {
    const memberRecord = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: session.user.id, groupId: id } },
      include: { tags: { select: { roleId: true } } },
    });
    const userRoleIds = new Set(memberRecord?.tags.map((t) => t.roleId) ?? []);

    visibleChannels = visibleChannels.filter((ch) => {
      // FIX-HIDDEN: скрытый канал обычный участник не видит в группе вообще;
      // модераторам и выше список не фильтруется (ветка isAdminRole).
      if (ch.hidden) return false;
      if (!ch.isRestricted) return true;
      if (ch.allowedRoles.length === 0) return true;
      return ch.allowedRoles.some((a) => userRoleIds.has(a.roleId));
    });
  }

  return NextResponse.json({
    ...group,
    channels: visibleChannels,
    // FIX-SRVSHOW: участники — с персональными настройками профиля для этой группы.
    members: group.members.map(withMemberOverrides),
    membersTotal,
    myRole: membership.role,
    rulesAccepted: membership.rulesAccepted,
    // FIX-PREMIUM-EXPIRED: клиент использует это поле для режима только-чтение.
    ownerHasPremium: hasPremium(group.owner),
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Сессия на JWT не аннулируется при бане, поэтому без этой проверки
  // забаненный с живым токеном продолжал бы менять настройки группы.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id } = await params;
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
  });

  // BUGFIX: ADMIN was previously excluded here — admins could not edit the group.
  if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN" && membership.role !== "MODERATOR")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { name, icon, description, rules, sectionsEnabled, banner, requireRules, paused, theme } = await req.json();

  const existing = await prisma.group.findUnique({
    where: { id },
    select: {
      name: true,
      rules: true,
      requireRules: true,
      ownerId: true,
      owner: { select: { isPremium: true, role: true } },
    },
  });

  if (!existing) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  // Разделы — премиум-функция: включить может только владелец с активным premium (или глобальный ADMIN)
  let sectionsData: { sectionsEnabled?: boolean } = {};
  if (sectionsEnabled !== undefined) {
    const ownerPremium = hasPremium(existing.owner);
    if (sectionsEnabled && !ownerPremium) {
      return NextResponse.json({ error: "Sections require a premium group owner" }, { status: 403 });
    }
    sectionsData = { sectionsEnabled: !!sectionsEnabled };
  }

  // NEW: пауза группы («скелетирование») — переключать могут только
  // владелец и администратор (модераторам нельзя).
  if (paused !== undefined && membership.role !== "OWNER" && membership.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Ставить группу на паузу может только владелец или администратор" },
      { status: 403 },
    );
  }

  // NEW: баннер сообщества хранится как data URL (как User.profileBanner).
  // Ограничиваем размер строки ~900 Кб (≈650 Кб бинарных данных).
  if (banner !== undefined && banner !== null) {
    if (typeof banner !== "string" || !banner.startsWith("data:image/") || banner.length > 900_000) {
      return NextResponse.json(
        { error: "Некорректный баннер: ожидается data:image/* размером до ~650 КБ" },
        { status: 400 },
      );
    }
  }

  // GROUP-SKIN: оформление меняют только владелец и администратор: это вид всего
  // сообщества, а не личная настройка модератора.
  let themeData: { theme?: string } = {};
  if (theme !== undefined) {
    if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Менять оформление сообщества может только владелец или администратор" },
        { status: 403 },
      );
    }
    if (theme !== null && (typeof theme !== "string" || theme.length > GROUP_THEME_MAX_JSON)) {
      return NextResponse.json({ error: "Некорректное оформление сообщества" }, { status: 400 });
    }
    // Прогон через разбор и сборку: в базу попадает только известный набор полей,
    // а не произвольный JSON из браузера.
    themeData = { theme: theme && String(theme).trim() ? serializeGroupTheme(parseGroupTheme(String(theme))) : "" };
  }

  const group = await prisma.group.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(icon !== undefined && { icon }),
      ...(description !== undefined && { description }),
      ...(rules !== undefined && { rules }),
      ...(banner !== undefined && { banner }),
      ...(requireRules !== undefined && { requireRules: !!requireRules }),
      ...(paused !== undefined && { paused: !!paused }),
      ...sectionsData,
      ...themeData,
    },
  });

  // NEW: если текст правил изменился и включено обязательное принятие —
  // все, кроме владельца, должны принять правила заново.
  const effectiveRequireRules = requireRules !== undefined ? !!requireRules : existing.requireRules;
  if (rules !== undefined && rules !== existing.rules && effectiveRequireRules) {
    await prisma.groupMember.updateMany({
      where: { groupId: id, role: { not: "OWNER" } },
      data: { rulesAccepted: false },
    });
  }

  // NEW: запись в групповой журнал аудита с перечнем изменённых полей.
  const changedFields = [
    name !== undefined && "название",
    icon !== undefined && "иконка",
    banner !== undefined && "баннер",
    description !== undefined && "описание",
    rules !== undefined && "правила",
    requireRules !== undefined && "обязательное принятие правил",
    sectionsEnabled !== undefined && "разделы",
    paused !== undefined && (paused ? "пауза группы (включена)" : "пауза группы (снята)"),
    theme !== undefined && "оформление сообщества",
  ].filter(Boolean).join(", ");

  if (changedFields) {
    await logGroupAction({
      groupId: id,
      actorId: session.user.id,
      actorName: session.user.username || session.user.name || "user",
      action: "settings.update",
      details: `Изменено: ${changedFields}`,
    });
  }

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "user",
    action: "update",
    target: "Group",
    targetId: id,
    details: `Редактирование группы "${group.name}"`,
  });

  // Notify every member so an edited name/icon propagates live to all open
  // clients (avatars of the group in the sidebar, invite dialogs, etc.).
  emitToUsers(await groupMemberIds(id), "group-updated", { id });

  return NextResponse.json(group);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Сессия на JWT не аннулируется при бане, поэтому без этой проверки
  // забаненный с живым токеном продолжал бы удалять группы.
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id } = await params;
  const group = await prisma.group.findUnique({ where: { id } });
  if (!group || group.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Only owner can delete" }, { status: 403 });
  }
  if (group.isMain) {
    return NextResponse.json({ error: "Cannot delete the main community" }, { status: 403 });
  }

  // Capture the members before the cascade delete removes the memberships, so
  // we can tell everyone to drop the group from their sidebar.
  const memberIds = await groupMemberIds(id);

  await prisma.group.delete({ where: { id } });

  emitToUsers(memberIds, "group-deleted", { id });

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "user",
    action: "delete",
    target: "Group",
    targetId: id,
    details: `Удаление группы "${group.name}"`,
  });

  return NextResponse.json({ ok: true });
}
