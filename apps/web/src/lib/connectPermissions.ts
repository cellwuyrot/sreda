import prisma from "@/lib/prisma";
import { isStaffRole } from "@/lib/businessChat";

export type BuiltInGroupRole = "OWNER" | "ADMIN" | "MODERATOR" | "MEMBER";

export interface ChannelPermissions {
  channelId: string;
  groupId: string;
  channelType: string;
  role: BuiltInGroupRole;
  isMember: boolean;
  isPaused: boolean;
  isRestricted: boolean;
  /** FIX-NEWSACL: кто может читать канал — ALL | MOD | ADMIN. */
  readAccess: string;
  /** FIX-QAACL: кто может задавать вопросы / отвечать — ALL | MOD | ADMIN | ROLES. */
  askAccess: string;
  answerAccess: string;
  allowedRoleIds: string[];
  /** FIX-QAACL: теги, допущенные задавать вопросы и отвечать. */
  askRoleIds: string[];
  answerRoleIds: string[];
  memberRoleIds: string[];
  canBypassPause: boolean;
  canView: boolean;
  canPost: boolean;
  /** NEWSPOST: право написать комментарий под постом ленты новостей. */
  canComment: boolean;
  canManage: boolean;
  canModerate: boolean;
  canJoinVoice: boolean;
  canUpload: boolean;
  /** FIX-QAACL: право задать вопрос и право ответить в разделе Q&A. */
  canAsk: boolean;
  canAnswer: boolean;
  denialReason: string | null;
}

const normalizeRole = (role: string): BuiltInGroupRole =>
  role === "OWNER" || role === "ADMIN" || role === "MODERATOR" ? role : "MEMBER";

/**
 * Поля канала, от которых зависят права. Вынесены в константу, потому что их
 * теперь читают два запроса — одиночный и пакетный, — и разойтись им нельзя:
 * недостающее поле молча превратилось бы в «доступ разрешён».
 */
const CHANNEL_SELECT = {
  id: true,
  groupId: true,
  type: true,
  isRestricted: true,
  hidden: true,
  postAccess: true,
  readAccess: true, // FIX-NEWSACL
  askAccess: true, // FIX-QAACL
  answerAccess: true, // FIX-QAACL
  group: { select: { paused: true } },
  allowedRoles: { select: { roleId: true, scope: true } },
} as const;

interface ChannelRow {
  id: string;
  groupId: string;
  type: string;
  isRestricted: boolean;
  hidden: boolean;
  postAccess: string;
  readAccess: string;
  askAccess: string;
  answerAccess: string;
  group: { paused: boolean };
  allowedRoles: { roleId: string; scope: string }[];
}

interface MembershipRow {
  role: string;
  tags: { roleId: string }[];
}

/**
 * Сами правила доступа. Функция чистая — никаких запросов: данные о канале и о
 * членстве ей приносят снаружи. Так одно и то же правило работает и когда
 * канал один, и когда их триста (поиск), и невозможна ситуация, при которой
 * «быстрый путь» разрешает то, что запрещает обычный.
 */
function evaluate(channel: ChannelRow, membership: MembershipRow | null): ChannelPermissions {
  const role = normalizeRole(membership?.role ?? "MEMBER");
  const isMember = !!membership;
  const canManage = isMember && (role === "OWNER" || role === "ADMIN");
  const canModerate = isMember && (canManage || role === "MODERATOR");
  const canBypassPause = canManage;
  // FIX-QAACL: один и тот же список ролей канала разложен по назначению.
  // Строки без scope (созданные до миграции) имеют значение по умолчанию
  // "VIEW", поэтому прежняя логика ограничения доступа не меняется.
  const rolesInScope = (scope: string): string[] =>
    channel.allowedRoles.filter((entry) => entry.scope === scope).map((entry) => entry.roleId);
  const allowedRoleIds = rolesInScope("VIEW");
  const askRoleIds = rolesInScope("ASK");
  const answerRoleIds = rolesInScope("ANSWER");
  const memberRoleIds = membership?.tags.map((entry) => entry.roleId) ?? [];
  const hasAllowedCustomRole = allowedRoleIds.length === 0 || allowedRoleIds.some((id) => memberRoleIds.includes(id));
  const passesRestriction = !channel.isRestricted || canModerate || hasAllowedCustomRole;
  // FIX-HIDDEN: скрытые каналы доступны только модераторам и выше. Обычный
  // участник не видит их и не может читать/писать даже по прямой ссылке.
  const passesHidden = !channel.hidden || canModerate;
  // FIX-NEWSACL: право читать канал по встроенной роли. Для новостей и любого
  // другого канала админ сообщества может закрыть чтение: MOD — модераторы и
  // выше, ADMIN — только владелец и администраторы. ALL (по умолчанию) —
  // прежнее поведение, читают все участники.
  const passesReadAccess =
    channel.readAccess === "ADMIN" ? canManage : channel.readAccess === "MOD" ? canModerate : true;
  const canView =
    isMember && passesRestriction && passesHidden && passesReadAccess && (!channel.group.paused || canBypassPause);

  /* Настройка раздела «кто может писать», выставленная руками админа. */
  const passesPostAccess =
    channel.postAccess === "ADMIN" ? canManage : channel.postAccess === "MOD" ? canModerate : true;
  /* Новости — лента, а не переписка: публиковать в ней может только модерация,
     независимо от postAccess. */
  const canPost = canView && passesPostAccess && (channel.type !== "NEWS" || canModerate);

  /* NEWSPOST: комментарий под постом — не публикация.

     Запрет на NEWS раньше сидел прямо в passesPostAccess, и вместе с новыми
     постами он закрывал бы и обсуждение: лента, в которой отвечать может
     только модерация, — это прежний молчащий канал. Поэтому право
     комментировать считается отдельно и снимает ТОЛЬКО запрет по типу канала.
     Явная настройка postAccess=MOD/ADMIN остаётся в силе: её админ выставил
     руками и имел в виду весь раздел, а не одни объявления.

     Закрыты ли комментарии у конкретного поста (commentsClosed) — вопрос поста,
     а не канала; его решает маршрут /api/posts/[id]/comments. */
  const canComment = canView && passesPostAccess;

  // FIX-QAACL: право задавать вопросы и право отвечать. ROLES без выбранных
  // тегов эквивалентен «все участники» — иначе настройка молча закрывала бы
  // раздел для всех, кроме модерации.
  const passesTagAccess = (mode: string, roleIds: string[]): boolean => {
    if (mode === "ADMIN") return canManage;
    if (mode === "MOD") return canModerate;
    if (mode === "ROLES") {
      if (canModerate) return true;
      if (roleIds.length === 0) return true;
      return roleIds.some((id) => memberRoleIds.includes(id));
    }
    return true;
  };
  const canAsk = canView && passesTagAccess(channel.askAccess, askRoleIds);
  const canAnswer = canView && passesTagAccess(channel.answerAccess, answerRoleIds);

  let denialReason: string | null = null;
  if (!isMember) denialReason = "Вы не состоите в этом сообществе";
  else if (channel.group.paused && !canBypassPause) denialReason = "Сообщество временно приостановлено";
  else if (!passesRestriction || !passesHidden || !passesReadAccess) denialReason = "У вас нет доступа к этому каналу";
  else if (!passesPostAccess) denialReason = "В этом канале недостаточно прав для публикации";

  return {
    channelId: channel.id,
    groupId: channel.groupId,
    channelType: channel.type,
    role,
    isMember,
    isPaused: channel.group.paused,
    isRestricted: channel.isRestricted,
    readAccess: channel.readAccess, // FIX-NEWSACL
    askAccess: channel.askAccess, // FIX-QAACL
    answerAccess: channel.answerAccess, // FIX-QAACL
    allowedRoleIds,
    askRoleIds,
    answerRoleIds,
    memberRoleIds,
    canBypassPause,
    canView,
    canPost,
    canComment, // NEWSPOST
    canManage,
    canModerate,
    canJoinVoice: canView,
    canUpload: canPost,
    canAsk, // FIX-QAACL
    canAnswer, // FIX-QAACL
    denialReason,
  };
}

/**
 * Canonical channel authorization used by REST routes and Socket.IO.
 * A restricted channel is visible only to built-in moderators or members with
 * one of its custom allowed roles. Empty allowedRoles preserves legacy behavior.
 */
export async function getChannelPermissions(userId: string, channelId: string): Promise<ChannelPermissions | null> {
  if (!userId || !channelId) return null;

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: CHANNEL_SELECT,
  });
  if (!channel) return null;

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId: channel.groupId } },
    select: { role: true, tags: { select: { roleId: true } } },
  });

  return evaluate(channel, membership);
}

/**
 * Права сразу на много каналов — два запроса вместо двух на каждый канал.
 *
 * Зачем: поиск и списки каналов раньше звали getChannelPermissions в цикле.
 * У человека в пяти сообществах по двадцать каналов это двести с лишним
 * запросов на одно нажатие — и всё это на маршруте, который дёргают при
 * каждом наборе строки.
 *
 * Правила те же самые: считает их та же функция evaluate. Здесь только сбор
 * данных — каналы одним запросом, членство в затронутых сообществах вторым.
 */
export async function getChannelPermissionsBatch(
  userId: string,
  channelIds: string[],
): Promise<Map<string, ChannelPermissions>> {
  const result = new Map<string, ChannelPermissions>();
  if (!userId || channelIds.length === 0) return result;

  const channels = await prisma.channel.findMany({
    where: { id: { in: channelIds } },
    select: CHANNEL_SELECT,
  });
  if (channels.length === 0) return result;

  const groupIds = Array.from(new Set(channels.map((channel) => channel.groupId)));
  const memberships = await prisma.groupMember.findMany({
    where: { userId, groupId: { in: groupIds } },
    select: { groupId: true, role: true, tags: { select: { roleId: true } } },
  });
  const membershipByGroup = new Map(memberships.map((entry) => [entry.groupId, entry]));

  for (const channel of channels) {
    result.set(channel.id, evaluate(channel, membershipByGroup.get(channel.groupId) ?? null));
  }
  return result;
}

/**
 * Каналы, которые пользователю действительно разрешено читать.
 *
 * Нужен там, где выборка идёт сразу по многим каналам, — прежде всего поиск.
 * Членство в сообществе доступа к каналу не даёт: канал бывает скрытым,
 * ограниченным по ролям или закрытым на чтение для всех, кроме модерации.
 * Поиск, который берёт «все каналы моих сообществ», отдаёт вместе с ними и
 * содержимое закрытых.
 */
export async function getVisibleChannelIds(userId: string, limit = 300): Promise<string[]> {
  if (!userId) return [];

  const memberships = await prisma.groupMember.findMany({
    where: { userId },
    select: { groupId: true },
  });
  const groupIds = memberships.map((entry) => entry.groupId);
  if (groupIds.length === 0) return [];

  const channels = await prisma.channel.findMany({
    where: { groupId: { in: groupIds } },
    select: { id: true },
    take: limit,
  });
  if (channels.length === 0) return [];

  const permissions = await getChannelPermissionsBatch(
    userId,
    channels.map((channel) => channel.id),
  );
  return channels.map((channel) => channel.id).filter((id) => permissions.get(id)?.canView);
}

/**
 * Доступ к переписке.
 *
 * Личная переписка — только двое её участников, как и было.
 *
 * Деловой разговор по обращению — ещё и вся администрация: очередь заявок общая,
 * и разговор, доставшийся отсутствующему человеку, не должен становиться
 * недоступным остальным. Проверка роли стоит ПОСЛЕ проверки участия и делает
 * лишний запрос только в этом случае — на личной переписке цена не меняется.
 */
export async function canAccessConversation(userId: string, conversationId: string): Promise<boolean> {
  if (!userId || !conversationId) return false;
  const conversation = await prisma.directConversation.findUnique({
    where: { id: conversationId },
    select: { user1Id: true, user2Id: true, kind: true },
  });
  if (!conversation) return false;
  if (conversation.user1Id === userId || conversation.user2Id === userId) return true;
  if (conversation.kind !== "BUSINESS") return false;
  const viewer = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  return isStaffRole(viewer?.role);
}

export async function getGroupRole(userId: string, groupId: string): Promise<BuiltInGroupRole | null> {
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
    select: { role: true },
  });
  return membership ? normalizeRole(membership.role) : null;
}
