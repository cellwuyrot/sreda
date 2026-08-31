/**
 * NETLINK: расчёт расхода трафика — чистые правила без базы данных.
 *
 * Одни и те же вычисления нужны в трёх местах: при отдаче списка пиров узлу
 * (кому соединение уже не полагается), в личном окне человека и в админской
 * сводке. Если держать их по местам, админская цифра и клиентская разойдутся,
 * и спор с пользователем будет неразрешим: две цифры и обе «правильные».
 *
 * Байты считаются в двоичных гигабайтах (1 ГБ = 1024³), как их показывает
 * любая операционная система: если считать по 1000³, человек сравнит нашу
 * цифру со своей и решит, что мы считаем в свою пользу.
 */

export const BYTES_IN_GB = 1024 ** 3;

/** Стандартный лимит. То же значение стоит в `@default` схемы. */
export const DEFAULT_TRAFFIC_LIMIT_GB = 250;
export const MAX_TRAFFIC_LIMIT_GB = 100_000;
export const DEFAULT_USAGE_PERIOD_DAYS = 30;
export const MIN_USAGE_PERIOD_DAYS = 1;
export const MAX_USAGE_PERIOD_DAYS = 365;
export const MIN_THROTTLE_KBPS = 128;
export const MAX_THROTTLE_KBPS = 1_000_000;

/**
 * Что происходит после исчерпания лимита.
 *
 * Вариантов ровно два, и оба исполнимы. Снятие соединения делает главный
 * сервер — просто не отдаёт пира узлу. Урезание скорости исполняет сам узел:
 * трафик идёт мимо главного сервера, и обещать формирование там, где его
 * технически негде выполнить, было бы обманом.
 */
export const OVER_LIMIT_ACTIONS = ["BLOCK", "THROTTLE"] as const;
export type OverLimitAction = (typeof OVER_LIMIT_ACTIONS)[number];

export function isOverLimitAction(value: unknown): value is OverLimitAction {
  return value === "BLOCK" || value === "THROTTLE";
}

export const OVER_LIMIT_LABELS: Record<OverLimitAction, string> = {
  BLOCK: "Отключить до конца периода",
  THROTTLE: "Оставить, но снизить скорость",
};

/** Минимум для расчёта: то, что есть и у пира в базе, и в ответе API. */
export interface UsageSubject {
  rxBytes: number;
  txBytes: number;
  usageResetAt: Date | string;
}

export interface TrafficSettingsSubject {
  trafficLimitGb: number;
  usagePeriodDays: number;
  overLimitAction: string;
  throttleKbps: number;
}

export interface UsageView {
  /** Сколько потрачено в текущем периоде (приём + отдача), байты. */
  usedBytes: number;
  /** Лимит периода в байтах. 0 — без ограничения. */
  limitBytes: number;
  /** Остаток. Без лимита — null, а не большое число. */
  remainingBytes: number | null;
  /** Доля расхода 0…100 для полоски. Без лимита — 0. */
  share: number;
  overLimit: boolean;
  /** Начало и конец текущего расчётного периода, ISO. */
  periodStart: string;
  periodEnd: string;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Наступил ли новый расчётный период.
 *
 * Период сбрасывается лениво — в момент, когда расход всё равно считают,
 * а не задачей по расписанию. Задача по расписанию для сброса счётчиков
 * требует отдельного планировщика и незаметно ломается, а ленивый сброс
 * не может не сработать: без чтения расхода он никому и не нужен.
 */
export function periodExpired(
  usageResetAt: Date | string,
  usagePeriodDays: number,
  now: Date = new Date(),
): boolean {
  return now.getTime() >= periodEndMs(usageResetAt, usagePeriodDays);
}

function periodEndMs(usageResetAt: Date | string, usagePeriodDays: number): number {
  const days = usagePeriodDays > 0 ? usagePeriodDays : DEFAULT_USAGE_PERIOD_DAYS;
  const start = toDate(usageResetAt).getTime();
  return start + days * 86_400_000;
}

/** Сводка по одному подписчику. */
export function usageView(
  peer: UsageSubject | null | undefined,
  settings: TrafficSettingsSubject,
  now: Date = new Date(),
): UsageView {
  const limitBytes = settings.trafficLimitGb > 0 ? settings.trafficLimitGb * BYTES_IN_GB : 0;
  const resetAt = peer ? toDate(peer.usageResetAt) : now;
  /* Срок вышел — показываем нули и новый период сразу, не дожидаясь записи
     в базу: иначе человек видел бы «лимит исчерпан» уже после обновления периода. */
  const expired = peer ? periodExpired(resetAt, settings.usagePeriodDays, now) : true;
  const usedBytes = !peer || expired ? 0 : Math.max(0, peer.rxBytes + peer.txBytes);
  const periodStart = !peer || expired ? now : resetAt;
  const remainingBytes = limitBytes > 0 ? Math.max(0, limitBytes - usedBytes) : null;
  const share = limitBytes > 0 ? Math.min(100, Math.round((usedBytes / limitBytes) * 100)) : 0;
  return {
    usedBytes,
    limitBytes,
    remainingBytes,
    share,
    overLimit: limitBytes > 0 && usedBytes >= limitBytes,
    periodStart: periodStart.toISOString(),
    periodEnd: new Date(periodEndMs(periodStart, settings.usagePeriodDays)).toISOString(),
  };
}

/**
 * Снимать ли соединение у этого пира прямо сейчас.
 *
 * Ответ зависит не только от расхода, но и от выбранного правила: при
 * «снизить скорость» пир остаётся в списке узла, и узлу уходит пометка
 * с потолком скорости.
 */
export function isTrafficBlocked(
  peer: UsageSubject | null | undefined,
  settings: TrafficSettingsSubject,
  now: Date = new Date(),
): boolean {
  if (!peer) return false;
  if (settings.overLimitAction === "THROTTLE") return false;
  return usageView(peer, settings, now).overLimit;
}

/** «12,4 ГБ» / «860 МБ» — без терабайтов и байтов, которые здесь не встречаются. */
export function formatTraffic(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 МБ";
  if (bytes === 0) return "0 МБ";
  const gb = bytes / BYTES_IN_GB;
  if (gb >= 10) return `${Math.round(gb)} ГБ`;
  if (gb >= 1) return `${gb.toFixed(1).replace(".", ",")} ГБ`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${Math.round(mb)} МБ`;
  return "меньше 1 МБ";
}

/** «ещё 12 дней» для конца периода или срока подписки. */
export function daysLeftLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "без срока";
  const end = new Date(iso).getTime();
  if (Number.isNaN(end)) return "без срока";
  const days = Math.ceil((end - now.getTime()) / 86_400_000);
  if (days <= 0) return "срок вышел";
  if (days === 1) return "остался 1 день";
  if (days < 5) return `осталось ${days} дня`;
  return `осталось ${days} дней`;
}
