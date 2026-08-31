/**
 * MODERATION: единственное место, где живут правила иерархии в группе.
 *
 * Роли (по рангу, от высшей к низшей):
 *  OWNER    = 4 — создатель, неприкосновенен
 *  ADMIN    = 3 — администратор
 *  MODERATOR = 2 — модератор
 *  GUIDE    = 1.5 — Проводник (временная роль на N дней, права как у модератора,
 *                   но не может воздействовать на модераторов и выше)
 *  MEMBER   = 1 — обычный участник
 */

export type GroupRoleName = "OWNER" | "ADMIN" | "MODERATOR" | "GUIDE" | "MEMBER";

/** Ранги. Больше число — больше власти. */
export const ROLE_RANK: Record<string, number> = {
  OWNER:     4,
  ADMIN:     3,
  MODERATOR: 2,
  GUIDE:     1.5,
  MEMBER:    1,
};

export const RANK_OWNER     = 4;
export const RANK_ADMIN     = 3;
export const RANK_MODERATOR = 2;
export const RANK_GUIDE     = 1.5;
export const RANK_MEMBER    = 1;

/** Читаемые названия ролей для интерфейса и записей журнала. */
export const ROLE_LABEL: Record<string, string> = {
  OWNER:     "Владелец",
  ADMIN:     "Администратор",
  MODERATOR: "Модератор",
  GUIDE:     "Проводник",
  MEMBER:    "Участник",
};

/**
 * Ранг роли. Незнакомая строка — это участник.
 */
export function rankOf(role: string | null | undefined): number {
  if (!role) return 0;
  return ROLE_RANK[role] ?? RANK_MEMBER;
}

/**
 * Эффективный ранг с учётом истечения срока роли GUIDE.
 * Если guidedUntil прошёл — Проводник считается обычным Участником.
 */
export function effectiveRank(
  member: { role: string; guidedUntil?: Date | string | null },
): number {
  if (
    member.role === "GUIDE" &&
    member.guidedUntil &&
    new Date(member.guidedUntil) <= new Date()
  ) {
    return RANK_MEMBER;
  }
  return rankOf(member.role);
}

/**
 * Может ли актор вообще применять меры к цели.
 * Минимальный ранг для модерации — GUIDE (1.5).
 */
export function canActOn(
  actorRole: string | null | undefined,
  targetRole: string | null | undefined,
): boolean {
  const actor = rankOf(actorRole);
  if (actor < RANK_GUIDE) return false;
  const target = targetRole ? rankOf(targetRole) : RANK_MEMBER;
  if (target >= RANK_OWNER) return false; // владельца не трогает никто
  return actor > target;
}

/* ── Перечень действий ─────────────────────────────────────────────────── */

export type ModerationAction =
  | "ignore"
  | "report"
  | "delete-message"
  | "delete-and-timeout"
  | "delete-and-ban"
  | "purge"
  | "timeout"
  | "untimeout"
  | "kick"
  | "ban"
  | "assign-tags"
  | "set-role";

/** Минимальный ранг актора для каждого действия. */
const ACTION_MIN_RANK: Record<ModerationAction, number> = {
  ignore:              0,
  report:              0,
  "delete-message":    RANK_GUIDE,
  "delete-and-timeout":RANK_GUIDE,
  "delete-and-ban":    RANK_GUIDE,
  purge:               RANK_GUIDE,
  timeout:             RANK_GUIDE,
  untimeout:           RANK_GUIDE,
  kick:                RANK_GUIDE,
  ban:                 RANK_GUIDE,
  "assign-tags":       RANK_ADMIN,
  "set-role":          RANK_ADMIN,
};

/** Действия, которые не требуют превосходства над целью (личные меры). */
const SELF_SERVE: ReadonlySet<ModerationAction> = new Set<ModerationAction>(["ignore", "report"]);

export interface ActorView {
  role: string | null | undefined;
  targetRole: string | null | undefined;
  isSelf: boolean;
  hasMessage?: boolean;
}

export function allowedActions(view: ActorView): ModerationAction[] {
  const out: ModerationAction[] = [];
  if (view.isSelf) return out;

  out.push("ignore", "report");

  if (!canActOn(view.role, view.targetRole)) return out;

  const rank = rankOf(view.role);
  const push = (a: ModerationAction) => {
    if (rank >= ACTION_MIN_RANK[a]) out.push(a);
  };

  if (view.hasMessage) {
    push("delete-message");
    push("delete-and-timeout");
    push("delete-and-ban");
  }
  push("purge");
  push("timeout");
  push("untimeout");
  push("kick");
  push("ban");
  push("assign-tags");
  push("set-role");

  return out;
}

export function isActionAllowed(action: ModerationAction, view: ActorView): boolean {
  if (view.isSelf && !SELF_SERVE.has(action)) return false;
  if (SELF_SERVE.has(action)) return !view.isSelf;
  if (rankOf(view.role) < ACTION_MIN_RANK[action]) return false;
  return canActOn(view.role, view.targetRole);
}

/**
 * Роли, которые актор вправе назначить.
 * OWNER может назначать ADMIN, MODERATOR, GUIDE, MEMBER.
 * ADMIN — MODERATOR, GUIDE, MEMBER.
 * MODERATOR — GUIDE, MEMBER.
 * GUIDE — никого (роль временная, не даёт права управлять другими ролями).
 */
export function assignableRoles(actorRole: string | null | undefined): GroupRoleName[] {
  const rank = rankOf(actorRole);
  const all: GroupRoleName[] = ["ADMIN", "MODERATOR", "GUIDE", "MEMBER"];
  return all.filter((r) => ROLE_RANK[r] < rank);
}

/* ── Массовая чистка ───────────────────────────────────────────────────── */

export type PurgeScope = "last10" | "last50" | "hour" | "day" | "all";

export const PURGE_SCOPES: { value: PurgeScope; label: string; take?: number; hours?: number }[] = [
  { value: "last10", label: "Последние 10 сообщений",   take: 10 },
  { value: "last50", label: "Последние 50 сообщений",   take: 50 },
  { value: "hour",  label: "Всё за последний час",       hours: 1 },
  { value: "day",   label: "Всё за сутки",               hours: 24 },
  { value: "all",   label: "Все сообщения в группе",     take: 10000 },
];

export function purgeScope(value: string): { take: number; since: Date | null } | null {
  const found = PURGE_SCOPES.find((s) => s.value === value);
  if (!found) return null;
  if (found.hours) {
    return { take: 500, since: new Date(Date.now() - found.hours * 3600000) };
  }
  return { take: found.take ?? 10, since: null };
}

/* ── Тайм-ауты ─────────────────────────────────────────────────────────── */

export const TIMEOUT_OPTIONS = [
  { label: "1 минута",  minutes: 1 },
  { label: "5 минут",   minutes: 5 },
  { label: "10 минут",  minutes: 10 },
  { label: "1 час",     minutes: 60 },
  { label: "1 день",    minutes: 1440 },
  { label: "7 дней",    minutes: 10080 },
] as const;

export const DELETE_AND_TIMEOUT_MINUTES = 10;
