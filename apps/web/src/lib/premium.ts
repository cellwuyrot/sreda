/**
 * Единое правило «есть ли у человека Premium».
 *
 * Правило было размазано по проекту в двух вариантах. В большинстве мест —
 * `isPremium || role === "ADMIN"`: администратор получает премиум по роли, и
 * именно так рисуется метка «Premium» в настройках, разблокируются темы,
 * шаблоны сообществ и оформление профиля. А в паре мест стояла голая проверка
 * `isPremium` — и получалось, что человек видит метку «Premium», но действие
 * ему отказывают. Ровно на этом ломалась смена юзернейма: интерфейс говорил
 * «у вас Premium», сервер отвечал «доступно только Premium-пользователям».
 *
 * Теперь правило одно и живёт здесь. Проверять премиум напрямую по полю
 * `isPremium` больше нигде не нужно — иначе расхождение вернётся.
 */

/** Роль аккаунта, которая даёт премиум автоматически, без подписки. */
export const PREMIUM_ROLE = "ADMIN";

/** Минимум, который нужен для проверки: флаг подписки и роль аккаунта. */
export interface PremiumSubject {
  isPremium?: boolean | null;
  role?: string | null;
}

/** Есть ли премиум — по подписке или по роли администратора. */
export function hasPremium(subject?: PremiumSubject | null): boolean {
  if (!subject) return false;
  return subject.isPremium === true || subject.role === PREMIUM_ROLE;
}

/** Откуда взялся премиум — нужно, чтобы честно объяснить это в настройках. */
export type PremiumSource = "none" | "role" | "subscription";

export function premiumSource(subject?: PremiumSubject | null): PremiumSource {
  if (!subject) return "none";
  if (subject.role === PREMIUM_ROLE) return "role";
  return subject.isPremium === true ? "subscription" : "none";
}
