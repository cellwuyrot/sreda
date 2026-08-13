/**
 * ROLE-CORE: единый источник правды по ролям приложения.
 *
 * До этого файла иерархия ролей была раскопирована по десяткам роутов и
 * страниц в виде `role !== "ADMIN" && role !== "EDITOR"`. Любая новая роль или
 * правка прав требовала обойти весь проект, и часть мест неизбежно отставала:
 * кнопка в панели была, а API отвечал 403 (или наоборот — что хуже).
 *
 * Роли:
 *  - USER        — обычный посетитель;
 *  - CONSULTANT  — партнёр, личный кабинет партнёра (/partner);
 *  - EDITOR      — редактор, выполняет выданную администратором работу;
 *  - ADMIN       — полный доступ.
 */

export const APP_ROLES = ["USER", "CONSULTANT", "EDITOR", "ADMIN"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}

/** Числовой вес роли: чем больше, тем выше права. */
export const ROLE_RANK: Record<AppRole, number> = {
  USER: 1,
  CONSULTANT: 2,
  EDITOR: 3,
  ADMIN: 4,
};

export function rankOf(role: string | null | undefined): number {
  return isAppRole(role) ? ROLE_RANK[role] : 0;
}

/** Сотрудник проекта: ведёт работу по проектам и обращениям. */
export function isStaffRole(role: string | null | undefined): boolean {
  return role === "EDITOR" || role === "ADMIN";
}

export function isAdminRole(role: string | null | undefined): boolean {
  return role === "ADMIN";
}

export function isPartnerRole(role: string | null | undefined): boolean {
  return role === "CONSULTANT";
}

/**
 * Какие роли данный актор вправе выдавать.
 *  - ADMIN выдаёт любые роли;
 *  - EDITOR (и партнёр в своём кабинете) — только USER и CONSULTANT: право
 *    заводить партнёров есть, право плодить редакторов и админов — нет.
 */
export function assignableRolesFor(actorRole: string | null | undefined): AppRole[] {
  if (isAdminRole(actorRole)) return [...APP_ROLES];
  if (actorRole === "EDITOR" || actorRole === "CONSULTANT") return ["USER", "CONSULTANT"];
  return [];
}

export function canAssignRole(actorRole: string | null | undefined, targetRole: unknown): boolean {
  return isAppRole(targetRole) && assignableRolesFor(actorRole).includes(targetRole);
}

/**
 * Может ли актор совершать действия над пользователем: только строго ниже себя
 * по рангу (или над самим собой). Равный ранг запрещён — иначе редактор правит
 * редактора, а админ разбанивает админа в обход журнала согласований.
 */
export function canActOnUser(
  actor: { id: string; role: string | null | undefined },
  target: { id: string; role: string | null | undefined },
): boolean {
  if (actor.id === target.id) return true;
  return rankOf(actor.role) > rankOf(target.role);
}

/**
 * ROLE-STRUCT: разделы админской панели, доступные редактору.
 * Всё остальное в /admin/* — только для ADMIN (см. AdminOnlySection).
 */
export const EDITOR_ADMIN_SECTIONS = [
  "users",
  "badges",
  "appeals",
  "projects",
  "notifications",
  "logs",
] as const;

export function canOpenAdminPath(role: string | null | undefined, pathname: string): boolean {
  if (isAdminRole(role)) return true;
  if (role !== "EDITOR") return false;
  const section = pathname.replace(/^\/admin\/?/, "").split("/")[0] || "";
  if (!section) return true; // корень /admin — общий вход в панель
  return (EDITOR_ADMIN_SECTIONS as readonly string[]).includes(section);
}
