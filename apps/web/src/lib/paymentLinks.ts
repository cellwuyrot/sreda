/**
 * PAYLINK: оплата подписки по одноразовой платёжной ссылке банка.
 *
 * ── Задача ─────────────────────────────────────────────────────────────
 *
 * Платёжная ссылка вида https://b2b.cbrpay.ru/XXXXXXXX создаётся в банке заранее
 * и живёт своей жизнью: сайт о ней ничего не знает и уведомления о зачислении не
 * получает. Об успешной оплате знают только банк и плательщик, у которого ссылка
 * показала «оплачено».
 *
 * Отсюда два правила, на которых держится модуль.
 *
 * 1. ОДНА ССЫЛКА = ОДНА ПОДПИСКА. Ссылка выдаётся адресно и после выдачи не
 *    предлагается больше никому: иначе двое заплатят по одному счёту, а сверить
 *    платежи будет нечем — идентификатора плательщика в ссылке нет.
 * 2. ПОДТВЕРЖДАЕТ ЧЕЛОВЕК. Нажатие «Я оплатил» — это заявка, а не оплата.
 *    Подписку включает администратор, сверившись с зачислением в банке. Для тех,
 *    кто готов доверять на слово, есть настройка `paylink_auto_activate`.
 *
 * Жизненный путь ссылки: FREE → RESERVED → AWAITING → USED. Тупиковое
 * состояние DISABLED — для ссылок, отозванных в банке.
 *
 * Модуль серверный: он пишет подписки и трогает флаги профиля.
 */
import prisma from "@/lib/prisma";
import { invalidateUserAuthCache } from "@/lib/auth";
import { emitToUser } from "@/lib/socketEmit";
import { vpnPlanExpiry, type VpnPlan } from "@/lib/vpnPlan";

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

/** Ссылка в том виде, в каком её можно показать плательщику. */
export interface PaymentLinkOffer {
  id: string;
  kind: PaymentLinkKind;
  plan: PaymentLinkPlan;
  planLabel: string;
  amount: number;
  currency: string;
  url: string;
  status: PaymentLinkStatus;
  reservationExpiresAt: string | null;
  paidReportedAt: string | null;
}

interface LinkRow {
  id: string;
  kind: string;
  plan: string;
  amount: number;
  currency: string;
  url: string;
  status: string;
  reservationExpiresAt: Date | null;
  paidReportedAt: Date | null;
}

export function toOffer(row: LinkRow): PaymentLinkOffer {
  const plan = isPaymentLinkPlan(row.plan) ? row.plan : "month";
  return {
    id: row.id,
    kind: isPaymentLinkKind(row.kind) ? row.kind : "PREMIUM",
    plan,
    planLabel: PAYMENT_LINK_PLAN_LABELS[plan],
    amount: row.amount,
    currency: row.currency,
    url: row.url,
    status: isPaymentLinkStatus(row.status) ? row.status : "FREE",
    reservationExpiresAt: row.reservationExpiresAt ? row.reservationExpiresAt.toISOString() : null,
    paidReportedAt: row.paidReportedAt ? row.paidReportedAt.toISOString() : null,
  };
}

const OFFER_SELECT = {
  id: true,
  kind: true,
  plan: true,
  amount: true,
  currency: true,
  url: true,
  status: true,
  reservationExpiresAt: true,
  paidReportedAt: true,
} as const;

/**
 * Возврат просроченных броней в пул.
 *
 * Только RESERVED: AWAITING ждёт решения администратора и по времени сгорать не
 * должен — человек уже заплатил, и отобрать у него ссылку значило бы потерять
 * платёж.
 */
export async function releaseExpiredReservations(now: Date = new Date()): Promise<number> {
  const result = await prisma.paymentLink.updateMany({
    where: { status: "RESERVED", reservationExpiresAt: { not: null, lt: now } },
    data: { status: "FREE", reservedById: null, reservedAt: null, reservationExpiresAt: null },
  });
  return result.count;
}

/** Уже выданная этому человеку ссылка на эту подписку, если она есть. */
export async function findActiveReservation(
  userId: string,
  kind: PaymentLinkKind,
): Promise<PaymentLinkOffer | null> {
  const row = await prisma.paymentLink.findFirst({
    where: { kind, reservedById: userId, status: { in: ["RESERVED", "AWAITING"] } },
    orderBy: { reservedAt: "desc" },
    select: OFFER_SELECT,
  });
  return row ? toOffer(row as LinkRow) : null;
}

export type ReserveResult =
  | { ok: true; offer: PaymentLinkOffer; reused: boolean }
  | { ok: false; reason: "none_available" | "race" };

/**
 * Выдать плательщику свободную ссылку.
 *
 * Захват идёт через `updateMany` с условием `status: "FREE"`: два человека,
 * нажавшие кнопку одновременно, не могут получить одну ссылку — второму условие
 * не выполнится, и он уйдёт на следующую. Транзакция здесь не поможет: она не
 * отменяет того, что «прочитал и записал» — это две операции.
 */
export async function reservePaymentLink(args: {
  userId: string;
  kind: PaymentLinkKind;
  plan?: PaymentLinkPlan | null;
  minutes?: number;
  now?: Date;
}): Promise<ReserveResult> {
  const now = args.now ?? new Date();
  const minutes = reserveMinutesFrom(args.minutes ?? DEFAULT_RESERVE_MINUTES);

  await releaseExpiredReservations(now);

  /* Одна ссылка = одна подписка: пока выданная ссылка не оплачена или не
     подтверждена, второй ссылки человек не получает. */
  const existing = await findActiveReservation(args.userId, args.kind);
  if (existing) return { ok: true, offer: existing, reused: true };

  const where = {
    kind: args.kind,
    status: "FREE" as const,
    ...(args.plan ? { plan: args.plan } : {}),
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = await prisma.paymentLink.findFirst({
      where,
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!candidate) return { ok: false, reason: "none_available" };

    const claimed = await prisma.paymentLink.updateMany({
      where: { id: candidate.id, status: "FREE" },
      data: {
        status: "RESERVED",
        reservedById: args.userId,
        reservedAt: now,
        reservationExpiresAt: new Date(now.getTime() + minutes * 60_000),
      },
    });
    if (claimed.count !== 1) continue; // ссылку забрали в этот же момент — берём следующую

    const row = await prisma.paymentLink.findUnique({
      where: { id: candidate.id },
      select: OFFER_SELECT,
    });
    if (!row) continue;
    return { ok: true, offer: toOffer(row as LinkRow), reused: false };
  }

  return { ok: false, reason: "race" };
}

export type ReportPaidResult =
  | { ok: true; offer: PaymentLinkOffer }
  | { ok: false; reason: "not_found" | "wrong_state" };

/**
 * «Я оплатил» от плательщика.
 *
 * Состояние меняется только у своей ссылки и только из RESERVED: повторное
 * нажатие ничего не портит, а сообщить об оплате чужой ссылки нельзя.
 */
export async function reportPaymentLinkPaid(args: {
  userId: string;
  linkId: string;
  reference?: string | null;
  now?: Date;
}): Promise<ReportPaidResult> {
  const now = args.now ?? new Date();
  const reference =
    typeof args.reference === "string" && args.reference.trim()
      ? args.reference.trim().slice(0, 200)
      : null;

  const link = await prisma.paymentLink.findUnique({
    where: { id: args.linkId },
    select: { id: true, status: true, reservedById: true },
  });
  if (!link || link.reservedById !== args.userId) return { ok: false, reason: "not_found" };
  if (link.status !== "RESERVED" && link.status !== "AWAITING") {
    return { ok: false, reason: "wrong_state" };
  }

  await prisma.paymentLink.update({
    where: { id: args.linkId },
    data: {
      status: "AWAITING",
      paidReportedAt: now,
      ...(reference ? { payerReference: reference } : {}),
      /* Бронь больше не сгорает по таймеру: платёж заявлен. */
      reservationExpiresAt: null,
    },
  });

  const row = await prisma.paymentLink.findUnique({
    where: { id: args.linkId },
    select: OFFER_SELECT,
  });
  return row ? { ok: true, offer: toOffer(row as LinkRow) } : { ok: false, reason: "not_found" };
}

/** Срок подписки от нужной точки отсчёта. Правило то же, что в маршрутах выдачи. */
export function planExpiry(plan: PaymentLinkPlan, from: Date): Date | null {
  return vpnPlanExpiry(plan as VpnPlan, from);
}

export type ActivateResult =
  | { ok: true; kind: PaymentLinkKind; userId: string; subscriptionId: string; expiresAt: Date | null }
  | { ok: false; reason: "not_found" | "wrong_state" | "no_payer" | "user_gone" };

/**
 * Подтверждение зачисления: выдать подписку и привязать её к профилю.
 *
 * Здесь та же последовательность, что в /api/admin/premium/subscriptions и
 * /api/admin/vpn/subscriptions — запись подписки, флаг профиля, сброс кэша
 * авторизации, событие клиенту. Отличие одно: ссылка переводится в USED в той же
 * транзакции, что и создание подписки. Иначе двойное нажатие «Подтвердить» дало
 * бы две подписки по одному платежу.
 */
export async function activatePaymentLink(args: {
  linkId: string;
  confirmedById: string | null;
  now?: Date;
}): Promise<ActivateResult> {
  const now = args.now ?? new Date();

  const link = await prisma.paymentLink.findUnique({ where: { id: args.linkId } });
  if (!link) return { ok: false, reason: "not_found" };
  if (link.status !== "AWAITING" && link.status !== "RESERVED") {
    return { ok: false, reason: "wrong_state" };
  }

  const userId = link.reservedById;
  if (!userId) return { ok: false, reason: "no_payer" };

  const kind: PaymentLinkKind = isPaymentLinkKind(link.kind) ? link.kind : "PREMIUM";
  const plan: PaymentLinkPlan = isPaymentLinkPlan(link.plan) ? link.plan : "month";

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, vpnAccess: true, vpnAccessUntil: true },
  });
  if (!user) return { ok: false, reason: "user_gone" };

  /* Продление считается от конца действующего срока: заплативший заранее не
     должен терять остаток. Для Premium точка отсчёта — конец действующей
     подписки по той же причине. */
  let base = now;
  if (kind === "VPN") {
    if (user.vpnAccess && user.vpnAccessUntil && user.vpnAccessUntil > now) base = user.vpnAccessUntil;
  } else {
    const active = await prisma.premiumSubscription.findFirst({
      where: { userId, status: "active", expiresAt: { not: null, gt: now } },
      orderBy: { expiresAt: "desc" },
      select: { expiresAt: true },
    });
    if (active?.expiresAt) base = active.expiresAt;
  }

  const expiresAt = planExpiry(plan, base);
  const note = `Оплата по ссылке ${link.url}`;

  const subscriptionId = await prisma.$transaction(async (tx) => {
    /* Захват ссылки внутри транзакции: если её уже подтвердили параллельно,
       условие не выполнится и подписка не создастся. */
    const claimed = await tx.paymentLink.updateMany({
      where: { id: link.id, status: link.status },
      data: {
        status: "USED",
        usedById: userId,
        usedAt: now,
        confirmedById: args.confirmedById,
        reservationExpiresAt: null,
      },
    });
    if (claimed.count !== 1) return null;

    if (kind === "VPN") {
      const sub = await tx.vpnSubscription.create({
        data: {
          userId,
          plan,
          paymentMethod: "acquiring",
          amount: link.amount,
          currency: link.currency,
          reference: link.payerReference || link.url.slice(0, 200),
          note,
          status: "active",
          startedAt: now,
          expiresAt,
          grantedById: args.confirmedById,
        },
        select: { id: true },
      });
      await tx.user.update({
        where: { id: userId },
        data: { vpnAccess: true, vpnAccessUntil: expiresAt },
      });
      await tx.paymentLink.update({ where: { id: link.id }, data: { subscriptionId: sub.id } });
      return sub.id;
    }

    const sub = await tx.premiumSubscription.create({
      data: {
        userId,
        plan,
        paymentMethod: "acquiring",
        amount: link.amount,
        currency: link.currency,
        reference: link.payerReference || link.url.slice(0, 200),
        note,
        status: "active",
        startedAt: now,
        expiresAt,
        grantedById: args.confirmedById,
      },
      select: { id: true },
    });
    await tx.user.update({ where: { id: userId }, data: { isPremium: true } });
    await tx.paymentLink.update({ where: { id: link.id }, data: { subscriptionId: sub.id } });
    return sub.id;
  });

  if (!subscriptionId) return { ok: false, reason: "wrong_state" };

  /* Кэш и события — после транзакции: до её конца клиенту сообщать нечего. */
  if (kind === "VPN") {
    emitToUser(userId, "account-vpn-updated", { vpnAccess: true, vpnAccessUntil: expiresAt });
  } else {
    invalidateUserAuthCache(userId);
    emitToUser(userId, "account-premium-updated", { isPremium: true });
  }

  return { ok: true, kind, userId, subscriptionId, expiresAt };
}

export type ReleaseResult = { ok: true } | { ok: false; reason: "not_found" | "wrong_state" };

/** Вернуть ссылку в пул: оплата не пришла или заявка ошибочна. */
export async function releasePaymentLink(linkId: string): Promise<ReleaseResult> {
  const link = await prisma.paymentLink.findUnique({
    where: { id: linkId },
    select: { id: true, status: true },
  });
  if (!link) return { ok: false, reason: "not_found" };
  if (link.status === "USED") return { ok: false, reason: "wrong_state" };

  await prisma.paymentLink.update({
    where: { id: linkId },
    data: {
      status: "FREE",
      reservedById: null,
      reservedAt: null,
      reservationExpiresAt: null,
      paidReportedAt: null,
      payerReference: null,
    },
  });
  return { ok: true };
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
