/**
 * VPN-PLAN: подписка «только VPN» — чистые правила без базы данных.
 *
 * ── Граница подписки ────────────────────────────────────────────
 *
 * Она даёт РОВНО одно: возможность включить и выключить VPN. Никакие другие
 * возможности Premium по ней НЕ выдаются: ни темы, ни битрейт голоса, ни
 * лимиты сообществ и сообщений. Поэтому здесь своё правило, а не ветка в
 * `lib/premium`: переиспользование `hasPremium` для VPN однажды неизбежно привело бы
 * к тому, что VPN-подписчик получил бы премиум-возможность по недосмотру.
 *
 * Модуль намеренно без `prisma`: его импортируют и серверные маршруты, и
 * клиентские компоненты настроек.
 */

/** Сроки, на которые выдаётся доступ. Совпадают с Premium не случайно:
 * администратор не должен держать в голове два набора тарифов. */
export const VPN_PLANS = ["month", "quarter", "year", "lifetime"] as const;
export type VpnPlan = (typeof VPN_PLANS)[number];

export function isVpnPlan(value: unknown): value is VpnPlan {
  return typeof value === "string" && (VPN_PLANS as readonly string[]).includes(value);
}

export const VPN_PLAN_LABELS: Record<VpnPlan, string> = {
  month: "Месяц",
  quarter: "3 месяца",
  year: "Год",
  lifetime: "Бессрочно",
};

/** Конец срока от даты старта. `null` — бессрочно. */
export function vpnPlanExpiry(plan: VpnPlan, from: Date): Date | null {
  const d = new Date(from);
  switch (plan) {
    case "month":
      d.setMonth(d.getMonth() + 1);
      return d;
    case "quarter":
      d.setMonth(d.getMonth() + 3);
      return d;
    case "year":
      d.setFullYear(d.getFullYear() + 1);
      return d;
    case "lifetime":
      return null;
  }
}

/** Минимум, нужный для проверки права на VPN по подписке. */
export interface VpnPlanSubject {
  vpnAccess?: boolean | null;
  vpnAccessUntil?: Date | string | null;
}

/**
 * Действует ли подписка ПРЯМО СЕЙЧАС.
 *
 * Срок проверяется по дате, а не только по флагу: задача просрочки ходит раз в
 * несколько часов, и в этом окне флаг ещё включён. Для VPN это не косметика:
 * туннель работал бы неоплаченным до ближайшего тика.
 */
export function hasActiveVpnPlan(subject?: VpnPlanSubject | null, now: Date = new Date()): boolean {
  if (!subject || subject.vpnAccess !== true) return false;
  const until = subject.vpnAccessUntil;
  if (until === null || until === undefined) return true; // бессрочно
  const end = until instanceof Date ? until : new Date(until);
  if (Number.isNaN(end.getTime())) return true;
  return end.getTime() > now.getTime();
}

/** Сколько полных дней осталось. `null` — срока нет. Отрицательное — срок вышел. */
export function vpnDaysLeft(
  until: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!until) return null;
  const end = until instanceof Date ? until : new Date(until);
  if (Number.isNaN(end.getTime())) return null;
  return Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
}
