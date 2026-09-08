/**
 * PAYLINK (общая часть): состояния, тарифы, названия и разбор ссылок.
 *
 * Файл выделен из `lib/paymentLinks.ts` сознательно. Там живёт серверная часть:
 * она трогает prisma и авторизацию, а те тянут за собой ioredis с узловыми `net`/`tls`/`dns`,
 * которых в браузере нет — сборка падала целиком. Здесь только чистые значения и
 * функции без внешних зависимостей, поэтому модуль одинаково годится и клиенту, и серверу:
 * названия состояний в админке и в API должны быть одни и те же.
 */

/** Какую подписку оплачивает ссылка. Совпадает с двумя платными подписками проекта. */
export const PAYMENT_LINK_KINDS = ["PREMIUM", "VPN"] as const;
export type PaymentLinkKind = (typeof PAYMENT_LINK_KINDS)[number];

export function isPaymentLinkKind(value: unknown): value is PaymentLinkKind {
  return typeof value === "string" && (PAYMENT_LINK_KINDS as readonly string[]).includes(value);
}

export const PAYMENT_LINK_KIND_LABELS: Record<PaymentLinkKind, string> = {
  PREMIUM: "Premium",
  VPN: "Ускоренный интернет",
};

/** Сроки те же, что у обеих подписок (lib/vpnPlan, admin/premium): один набор тарифов. */
export const PAYMENT_LINK_PLANS = ["month", "quarter", "year", "lifetime"] as const;
export type PaymentLinkPlan = (typeof PAYMENT_LINK_PLANS)[number];

export function isPaymentLinkPlan(value: unknown): value is PaymentLinkPlan {
  return typeof value === "string" && (PAYMENT_LINK_PLANS as readonly string[]).includes(value);
}

export const PAYMENT_LINK_PLAN_LABELS: Record<PaymentLinkPlan, string> = {
  month: "Месяц",
  quarter: "3 месяца",
  year: "Год",
  lifetime: "Бессрочно",
};

export const PAYMENT_LINK_STATUSES = ["FREE", "RESERVED", "AWAITING", "USED", "DISABLED"] as const;
export type PaymentLinkStatus = (typeof PAYMENT_LINK_STATUSES)[number];

export function isPaymentLinkStatus(value: unknown): value is PaymentLinkStatus {
  return typeof value === "string" && (PAYMENT_LINK_STATUSES as readonly string[]).includes(value);
}

export const PAYMENT_LINK_STATUS_LABELS: Record<PaymentLinkStatus, string> = {
  FREE: "Свободна",
  RESERVED: "Выдана, ждём оплату",
  AWAITING: "Оплату подтверждает администратор",
  USED: "Использована",
  DISABLED: "Отключена",
};

/** Дольше держать бронь незачем: ссылка простаивает, а очередь ждёт. */
export const DEFAULT_RESERVE_MINUTES = 60;
export const MIN_RESERVE_MINUTES = 5;
export const MAX_RESERVE_MINUTES = 60 * 24 * 7;

/** Больше — это уже не пул, а выгрузка из банка целиком: один запрос не должен её тянуть. */
export const MAX_LINKS_PER_IMPORT = 200;
export const MAX_LINK_URL_LENGTH = 500;

export function reserveMinutesFrom(raw: string | number | null | undefined): number {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return DEFAULT_RESERVE_MINUTES;
  return Math.min(MAX_RESERVE_MINUTES, Math.max(MIN_RESERVE_MINUTES, Math.round(n)));
}

/**
 * Приведение ссылки к пригодному виду.
 *
 * Ссылки приходят копипастой из банка и из мессенджеров: со скобками, кавычками,
 * запятыми, иногда завёрнутые в markdown. Требование ровно одно и оно
 * содержательное — https и живой хост: по http платёжную ссылку открывать нельзя,
 * а конкретный банк не зашит, потому что ссылки бывают не только cbrpay.
 */
export function normalizePaymentLinkUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  if (!value) return null;

  // markdown-обёртка [текст](ссылка) — берём ссылку
  const md = value.match(/\]\((https?:\/\/[^\s)]+)\)/i);
  if (md) value = md[1];

  value = value.replace(/^[<"'(\[]+/, "").replace(/[>"')\],.;]+$/, "").trim();
  if (value.length > MAX_LINK_URL_LENGTH) return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (!parsed.hostname || !parsed.hostname.includes(".")) return null;
  return parsed.toString();
}

export interface ParsedLinkList {
  urls: string[];
  invalid: string[];
  duplicates: string[];
}

/**
 * Разбор списка ссылок из одного поля ввода.
 *
 * Администратор создаёт ссылки партиями, и вводить их по одной — работа ради
 * работы. Повторы внутри партии отсекаются здесь, повторы с базой — уникальным
 * индексом на `url`.
 */
export function parsePaymentLinkList(text: unknown): ParsedLinkList {
  const source = typeof text === "string" ? text : "";
  const parts = source
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const urls: string[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const url = normalizePaymentLinkUrl(part);
    if (!url) {
      invalid.push(part.slice(0, 120));
      continue;
    }
    if (seen.has(url)) {
      duplicates.push(url);
      continue;
    }
    seen.add(url);
    urls.push(url);
  }

  return { urls, invalid, duplicates };
}

export interface PaymentLinkStats {
  total: number;
  free: number;
  reserved: number;
  awaiting: number;
  used: number;
  disabled: number;
}

export function summarizePaymentLinks(rows: Array<{ status: string }>): PaymentLinkStats {
  const stats: PaymentLinkStats = { total: 0, free: 0, reserved: 0, awaiting: 0, used: 0, disabled: 0 };
  for (const row of rows) {
    stats.total += 1;
    if (row.status === "FREE") stats.free += 1;
    else if (row.status === "RESERVED") stats.reserved += 1;
    else if (row.status === "AWAITING") stats.awaiting += 1;
    else if (row.status === "USED") stats.used += 1;
    else if (row.status === "DISABLED") stats.disabled += 1;
  }
  return stats;
}
