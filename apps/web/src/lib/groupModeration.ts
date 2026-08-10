/**
 * MODERATION: единственное место, где живут правила иерархии в группе.
 *
 * До этого модуля `ROLE_RANK` был скопирован в семь файлов — в каждый маршрут
 * модерации и в два компонента. Копии уже начинали расходиться: в
 * `MessageArea.tsx` в карту рангов добавили ключ `SITE_ADMIN` — и он там
 * мёртвый: карта применяется к `currentUserCommunityRole`, а это поле такого
 * значения не принимает никогда (сайтовая роль лежит в соседнем
 * `currentUserRole`). Ошибка безобидная, но показательная: копии расходятся
 * молча, сборка на это не падает, и заметить можно только тем, что клиент
 * рисует кнопку, которую сервер отклоняет.
 *
 * Файл намеренно чистый: ни prisma, ни next, ни единого импорта. Только так
 * его можно импортировать и в серверный маршрут, и в клиентский компонент, а
 * значит — иметь одно правило вместо двух похожих.
 *
 * ── Правило одно ──────────────────────────────────────────────────────────
 *
 * Действие против другого участника требует СТРОГО большего ранга. Равные
 * ранги не трогают друг друга: модератор не забанит модератора, админ не
 * забанит админа. Владелец неприкосновенен для всех и уходит только через
 * передачу владения.
 *
 * Из одного этого правила выводится вся таблица прав — отдельных исключений
 * вида «модератор не может забанить администратора» писать не нужно, они
 * следуют из рангов.
 */

export type GroupRoleName = "OWNER" | "ADMIN" | "MODERATOR" | "MEMBER";

/** Ранги. Больше число — больше власти. */
export const ROLE_RANK: Record<string, number> = {
  OWNER: 4,
  ADMIN: 3,
  MODERATOR: 2,
  MEMBER: 1,
};

export const RANK_OWNER = 4;
export const RANK_ADMIN = 3;
export const RANK_MODERATOR = 2;
export const RANK_MEMBER = 1;

/** Читаемые названия ролей для интерфейса и записей журнала. */
export const ROLE_LABEL: Record<string, string> = {
  OWNER: "Владелец",
  ADMIN: "Администратор",
  MODERATOR: "Модератор",
  MEMBER: "Участник",
};

/**
 * Ранг роли. Незнакомая строка — это участник: `GroupMember.role` в схеме
 * обычная строка, и молча повышать неизвестное значение было бы опасно.
 */
export function rankOf(role: string | null | undefined): number {
  if (!role) return 0;
  return ROLE_RANK[role] ?? RANK_MEMBER;
}

/**
 * Может ли актор вообще применять меры к цели.
 *
 * `null` в роли цели означает «человек не состоит в группе»: так бывает при
 * бане по упоминанию в чужом сообщении, когда участник уже вышел. Ранг такого
 * равен рангу обычного участника — иначе забанить вышедшего было бы нельзя.
 */
export function canActOn(actorRole: string | null | undefined, targetRole: string | null | undefined): boolean {
  const actor = rankOf(actorRole);
  if (actor < RANK_MODERATOR) return false;
  const target = targetRole ? rankOf(targetRole) : RANK_MEMBER;
  if (target >= RANK_OWNER) return false; // владельца не трогает никто
  return actor > target;
}

/* ── Перечень действий ─────────────────────────────────────────────────── */

export type ModerationAction =
  /** Доступно всем, включая обычного участника. */
  | "ignore"
  | "report"
  /** Модератор и выше — против строго младших. */
  | "delete-message"
  | "delete-and-timeout"
  | "delete-and-ban"
  | "purge"
  | "timeout"
  | "untimeout"
  | "kick"
  | "ban"
  /** Администратор и выше. */
  | "assign-tags"
  | "set-role";

/** Минимальный ранг актора для каждого действия. */
const ACTION_MIN_RANK: Record<ModerationAction, number> = {
  ignore: 0,
  report: 0,
  "delete-message": RANK_MODERATOR,
  "delete-and-timeout": RANK_MODERATOR,
  "delete-and-ban": RANK_MODERATOR,
  purge: RANK_MODERATOR,
  timeout: RANK_MODERATOR,
  untimeout: RANK_MODERATOR,
  kick: RANK_MODERATOR,
  ban: RANK_MODERATOR,
  "assign-tags": RANK_ADMIN,
  "set-role": RANK_ADMIN,
};

/** Действия, которые не требуют превосходства над целью (личные меры). */
const SELF_SERVE: ReadonlySet<ModerationAction> = new Set<ModerationAction>(["ignore", "report"]);

export interface ActorView {
  /** Роль смотрящего в этой группе. */
  role: string | null | undefined;
  /** Роль цели, либо null, если цель не состоит в группе. */
  targetRole: string | null | undefined;
  /** Цель — это он сам. */
  isSelf: boolean;
  /** Есть ли конкретное сообщение, к которому применимы «удалить…». */
  hasMessage?: boolean;
}

/**
 * Что смотрящий может сделать с целью. Одна и та же функция вызывается на
 * клиенте (чтобы не рисовать заведомо мёртвые пункты) и на сервере (чтобы
 * решение принималось там, где ему и место). Клиентский список — подсказка,
 * а не разрешение: маршруты проверяют себя сами.
 */
export function allowedActions(view: ActorView): ModerationAction[] {
  const out: ModerationAction[] = [];
  if (view.isSelf) return out; // над собой мер не принимают

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
  /* «Снять таймаут» показываем всегда рядом с выдачей, не сверяясь с текущим
     состоянием цели: список участников не возит с собой mutedUntil, а тянуть
     его в чат ради одной строки меню — лишний запрос. Снятие несуществующего
     ограничения ничего не портит: маршрут просто обнуляет поля. */
  push("untimeout");
  push("kick");
  push("ban");
  push("assign-tags");
  push("set-role");

  return out;
}

/** Проверка одного действия — то же правило, но без сборки списка. */
export function isActionAllowed(action: ModerationAction, view: ActorView): boolean {
  if (view.isSelf && !SELF_SERVE.has(action)) return false;
  if (SELF_SERVE.has(action)) return !view.isSelf;
  if (rankOf(view.role) < ACTION_MIN_RANK[action]) return false;
  return canActOn(view.role, view.targetRole);
}

/**
 * Роли, которые актор вправе назначить: строго ниже собственной. Владелец
 * назначает вплоть до администратора, администратор — до модератора.
 * `OWNER` не выдаётся никогда: владение передаётся отдельным маршрутом, иначе
 * в группе оказалось бы два владельца.
 */
export function assignableRoles(actorRole: string | null | undefined): GroupRoleName[] {
  const rank = rankOf(actorRole);
  const all: GroupRoleName[] = ["ADMIN", "MODERATOR", "MEMBER"];
  return all.filter((r) => ROLE_RANK[r] < rank);
}

/* ── Массовая чистка ───────────────────────────────────────────────────── */

export type PurgeScope = "last10" | "last50" | "hour" | "day";

export const PURGE_SCOPES: { value: PurgeScope; label: string; take?: number; hours?: number }[] = [
  { value: "last10", label: "Последние 10 сообщений", take: 10 },
  { value: "last50", label: "Последние 50 сообщений", take: 50 },
  { value: "hour", label: "Всё за последний час", hours: 1 },
  { value: "day", label: "Всё за сутки", hours: 24 },
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
  { label: "1 минута", minutes: 1 },
  { label: "5 минут", minutes: 5 },
  { label: "10 минут", minutes: 10 },
  { label: "1 час", minutes: 60 },
  { label: "1 день", minutes: 1440 },
  { label: "7 дней", minutes: 10080 },
] as const;

/** Тайм-аут, которым сопровождается «удалить и ограничить». */
export const DELETE_AND_TIMEOUT_MINUTES = 10;
