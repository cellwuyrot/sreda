/**
 * PAY-TEMPLATE: шаблоны платёжных реквизитов.
 *
 * ── Задача ─────────────────────────────────────────────────────────────
 *
 * Раздел «Платежи» знал ровно один набор реквизитов проекта (SiteConfig), а счёт
 * в деловом чате — только текстовое поле «Реквизиты для оплаты». Пока счета
 * выставляет один человек от одного юрлица, этого достаточно. Когда
 * администраторов несколько, набор перестаёт быть одним: у каждого своё ИП, свой
 * СБП-телефон, свой терминал; часть работ идёт через общее юрлицо проекта.
 * Раньше это решалось дописыванием реквизитов в счёт руками при каждом
 * выставлении — то есть ошибкой, которая стоит денег.
 *
 * Здесь: именованные шаблоны, личные и общие, с признаком «по умолчанию».
 * Шаблон подставляется в счёт, но в самом счёте остаётся СНИМОК текста —
 * правка шаблона не меняет условия уже выставленного счёта.
 *
 * Модуль серверный: он читает базу и общие настройки платежей.
 */
import prisma from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { readBusinessRequisitesText, readPaymentConfig } from "@/lib/paymentSettings";

export const REQUISITE_SCOPES = ["BUSINESS", "PREMIUM"] as const;
export type RequisiteScope = (typeof REQUISITE_SCOPES)[number];

export function isRequisiteScope(value: unknown): value is RequisiteScope {
  return typeof value === "string" && (REQUISITE_SCOPES as readonly string[]).includes(value);
}

export const REQUISITE_MODES = ["ONE_TIME", "SUBSCRIPTION"] as const;
export const REQUISITE_PERIODS = ["MONTH", "QUARTER", "YEAR"] as const;

/** Больше — уже не справочник, а свалка: искать нужный шаблон станет дольше,
 *  чем ввести реквизиты руками. */
export const MAX_REQUISITES_PER_OWNER = 30;

/** Поля шаблона в том виде, в каком их принимает и отдаёт API. */
export interface RequisiteFields {
  name: string;
  scope: RequisiteScope;
  /** true — общий шаблон проекта (ownerId = null). */
  shared: boolean;
  isDefault: boolean;
  orgName: string;
  inn: string;
  kpp: string;
  bank: string;
  bik: string;
  account: string;
  corrAccount: string;
  purpose: string;
  sbpEnabled: boolean;
  sbpPhone: string;
  sbpBank: string;
  sbpRecipient: string;
  acquiringEnabled: boolean;
  acquiringProvider: string;
  acquiringLink: string;
  acquiringMerchant: string;
  comment: string;
  bodyOverride: string;
  mode: string;
  period: string | null;
}

const FIELD_LIMITS: Record<string, number> = {
  name: 120,
  orgName: 200,
  inn: 20,
  kpp: 20,
  bank: 200,
  bik: 20,
  account: 34,
  corrAccount: 34,
  purpose: 300,
  sbpPhone: 32,
  sbpBank: 120,
  sbpRecipient: 200,
  acquiringProvider: 120,
  acquiringLink: 500,
  acquiringMerchant: 120,
  comment: 2000,
  bodyOverride: 4000,
};

const TEXT_FIELDS = Object.keys(FIELD_LIMITS);
const BOOL_FIELDS = ["sbpEnabled", "acquiringEnabled", "isDefault"] as const;

function clean(value: unknown, limit: number): string {
  /* sanitizeText — тот же санитайзер, что и в остальных админских формах:
     реквизиты попадают в счёт, который читает клиент. */
  return sanitizeText(typeof value === "string" ? value : "").trim().slice(0, limit);
}

/**
 * Разобрать присланный объект в набор изменений.
 *
 * Возвращаются ТОЛЬКО те поля, которые пришли: PATCH не должен затирать
 * незаполненное. Ссылка эквайринга проверяется на схему — «ссылка», ведущая
 * на javascript:, в счёте клиенту не нужна.
 */
export function parseRequisitePatch(
  body: unknown,
): { patch: Record<string, unknown> } | { error: string } {
  if (!body || typeof body !== "object") return { error: "Пустой запрос" };
  const raw = body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  for (const key of TEXT_FIELDS) {
    if (raw[key] === undefined) continue;
    patch[key] = clean(raw[key], FIELD_LIMITS[key]);
  }
  for (const key of BOOL_FIELDS) {
    if (raw[key] === undefined) continue;
    patch[key] = raw[key] === true || raw[key] === "1";
  }

  if (raw.scope !== undefined) {
    if (!isRequisiteScope(raw.scope)) return { error: "Неизвестное назначение шаблона" };
    patch.scope = raw.scope;
  }
  if (raw.mode !== undefined) {
    if (!(REQUISITE_MODES as readonly string[]).includes(String(raw.mode))) {
      return { error: "Неизвестный способ выставления" };
    }
    patch.mode = String(raw.mode);
  }
  if (raw.period !== undefined) {
    if (raw.period === null || raw.period === "") {
      patch.period = null;
    } else if ((REQUISITE_PERIODS as readonly string[]).includes(String(raw.period))) {
      patch.period = String(raw.period);
    } else {
      return { error: "Неизвестный период подписки" };
    }
  }

  if (typeof patch.name === "string" && patch.name.length === 0) {
    return { error: "У шаблона должно быть название" };
  }
  if (typeof patch.acquiringLink === "string" && patch.acquiringLink) {
    if (!/^https?:\/\//i.test(patch.acquiringLink)) {
      return { error: "Платёжная ссылка должна начинаться с http:// или https://" };
    }
  }
  /* Цифровые поля — только цифры: БИК с пробелами бухгалтерия не примет, а
     молча «почистить» чужие данные хуже, чем сказать об ошибке. */
  for (const key of ["inn", "kpp", "bik", "account", "corrAccount"]) {
    const value = patch[key];
    if (typeof value === "string" && value && !/^\d+$/.test(value)) {
      return { error: "ИНН, КПП, БИК и номера счетов заполняются цифрами" };
    }
  }

  return { patch };
}

/** Строка шаблона, как её отдаёт база (нужные поля). */
export interface RequisiteRow {
  id: string;
  name: string;
  scope: string;
  ownerId: string | null;
  isDefault: boolean;
  orgName: string;
  inn: string;
  kpp: string;
  bank: string;
  bik: string;
  account: string;
  corrAccount: string;
  purpose: string;
  sbpEnabled: boolean;
  sbpPhone: string;
  sbpBank: string;
  sbpRecipient: string;
  acquiringEnabled: boolean;
  acquiringProvider: string;
  acquiringLink: string;
  acquiringMerchant: string;
  comment: string | null;
  bodyOverride: string | null;
  mode: string;
  period: string | null;
}

/**
 * Текст реквизитов для счёта.
 *
 * Если заполнен `bodyOverride` — он и идёт в счёт: это осознанно введённый
 * человеком текст, и «улучшать» его сборкой из полей нельзя.
 */
export function requisiteText(row: RequisiteRow): string {
  if (row.bodyOverride && row.bodyOverride.trim()) return row.bodyOverride.trim();

  const blocks: string[] = [];

  const invoice = [
    ["Получатель", row.orgName],
    ["ИНН", row.inn],
    ["КПП", row.kpp],
    ["Банк", row.bank],
    ["БИК", row.bik],
    ["Р/Счёт", row.account],
    ["Корр. счёт", row.corrAccount],
    ["Назначение платежа", row.purpose],
  ].filter(([, value]) => value);
  if (invoice.length > 0) {
    blocks.push(["Оплата по счёту", ...invoice.map(([l, v]) => `${l}: ${v}`)].join("\n"));
  }

  if (row.sbpEnabled && row.sbpPhone) {
    const lines = [
      ["Телефон", row.sbpPhone],
      ["Банк", row.sbpBank],
      ["Получатель", row.sbpRecipient],
    ].filter(([, value]) => value);
    blocks.push(["СБП-перевод", ...lines.map(([l, v]) => `${l}: ${v}`)].join("\n"));
  }

  if (row.acquiringEnabled && (row.acquiringLink || row.acquiringProvider)) {
    const lines: string[] = [];
    if (row.acquiringProvider) lines.push(`Провайдер: ${row.acquiringProvider}`);
    if (row.acquiringLink) lines.push(`Ссылка: ${row.acquiringLink}`);
    blocks.push(["Интернет-эквайринг", ...lines].join("\n"));
  }

  if (row.comment && row.comment.trim()) blocks.push(row.comment.trim());

  return blocks.join("\n\n");
}

export const REQUISITE_SELECT = {
  id: true,
  name: true,
  scope: true,
  ownerId: true,
  isDefault: true,
  orgName: true,
  inn: true,
  kpp: true,
  bank: true,
  bik: true,
  account: true,
  corrAccount: true,
  purpose: true,
  sbpEnabled: true,
  sbpPhone: true,
  sbpBank: true,
  sbpRecipient: true,
  acquiringEnabled: true,
  acquiringProvider: true,
  acquiringLink: true,
  acquiringMerchant: true,
  comment: true,
  bodyOverride: true,
  mode: true,
  period: true,
  usedCount: true,
  lastUsedAt: true,
  createdByName: true,
  updatedAt: true,
  owner: { select: { id: true, name: true, username: true } },
} as const;

/**
 * Шаблоны, доступные администратору: его личные и общие проекта.
 *
 * Чужие ЛИЧНЫЕ шаблоны не отдаются никому — это банковские данные конкретного
 * человека, а не общий справочник. Порядок: свои раньше общих, «по умолчанию»
 * раньше остальных.
 */
export async function listRequisitesFor(userId: string, scope?: RequisiteScope) {
  const rows = await prisma.paymentRequisite.findMany({
    where: {
      ...(scope ? { scope } : {}),
      OR: [{ ownerId: userId }, { ownerId: null }],
    },
    select: REQUISITE_SELECT,
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return rows.sort((a, b) => {
    const mine = Number(Boolean(b.ownerId)) - Number(Boolean(a.ownerId));
    if (mine !== 0) return mine;
    const def = Number(b.isDefault) - Number(a.isDefault);
    if (def !== 0) return def;
    return a.name.localeCompare(b.name, "ru");
  });
}

/** Можно ли администратору видеть и править этот шаблон. */
export function canUseRequisite(row: { ownerId: string | null }, userId: string): boolean {
  return row.ownerId === null || row.ownerId === userId;
}

/**
 * Снять признак «по умолчанию» с остальных шаблонов той же группы.
 *
 * Группа — это назначение (BUSINESS/PREMIUM) и владелец. Личный и общий
 * умолчания живут независимо: личный просто главнее при подстановке.
 */
export async function clearDefaults(scope: string, ownerId: string | null, exceptId?: string) {
  await prisma.paymentRequisite.updateMany({
    where: {
      scope,
      ownerId,
      isDefault: true,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    data: { isDefault: false },
  });
}

/** Шаблон по умолчанию: сначала личный, затем общий. */
export async function defaultRequisiteFor(userId: string, scope: RequisiteScope) {
  const own = await prisma.paymentRequisite.findFirst({
    where: { ownerId: userId, scope, isDefault: true },
    select: REQUISITE_SELECT,
  });
  if (own) return own;
  return prisma.paymentRequisite.findFirst({
    where: { ownerId: null, scope, isDefault: true },
    select: REQUISITE_SELECT,
  });
}

export interface ResolvedRequisites {
  text: string;
  requisiteId: string | null;
  /** Откуда взялся текст — идёт в журнал действий. */
  source: "manual" | "template" | "default" | "settings" | "none";
}

/**
 * Какие реквизиты попадут в счёт.
 *
 * Порядок намеренно такой:
 *   1. текст, введённый руками в самой форме — человек знает, что делает;
 *   2. выбранный шаблон;
 *   3. шаблон по умолчанию (личный, затем общий);
 *   4. общие реквизиты проекта из раздела «Платежи».
 * Счёт без реквизитов — самая частая причина неоплаты, поэтому вниз цепочки
 * поставлены общие настройки, а не пустая строка.
 */
export async function resolveRequisites(args: {
  manual: string;
  requisiteId?: string | null;
  userId: string;
  scope?: RequisiteScope;
}): Promise<ResolvedRequisites> {
  const scope = args.scope ?? "BUSINESS";

  if (args.requisiteId) {
    const row = await prisma.paymentRequisite.findUnique({
      where: { id: args.requisiteId },
      select: REQUISITE_SELECT,
    });
    if (!row || !canUseRequisite(row, args.userId)) {
      throw new Error("Шаблон реквизитов не найден");
    }
    /* Ручной текст при выбранном шаблоне не отбрасывается: администратор мог
       подставить шаблон и дописать номер счёта. Приоритет у того, что он видит
       перед собой в форме. */
    const text = args.manual || requisiteText(row);
    return { text, requisiteId: row.id, source: args.manual ? "manual" : "template" };
  }

  if (args.manual) return { text: args.manual, requisiteId: null, source: "manual" };

  const fallback = await defaultRequisiteFor(args.userId, scope);
  if (fallback) {
    return { text: requisiteText(fallback), requisiteId: fallback.id, source: "default" };
  }

  const settings = await readBusinessRequisitesText();
  if (settings) return { text: settings, requisiteId: null, source: "settings" };

  return { text: "", requisiteId: null, source: "none" };
}

/** Отметить использование шаблона. Ошибка счёта из-за счётчика недопустима. */
export async function bumpRequisiteUsage(id: string | null | undefined) {
  if (!id) return;
  try {
    await prisma.paymentRequisite.update({
      where: { id },
      data: { usedCount: { increment: 1 }, lastUsedAt: new Date() },
    });
  } catch {
    /* Шаблон могли удалить между выставлением и записью — счёт уже создан. */
  }
}

/**
 * Заготовка шаблона из общих настроек раздела «Платежи».
 *
 * Нужна, чтобы первый шаблон не приходилось набивать заново: у проекта уже есть
 * заполненные реквизиты, и «перенести их в шаблон» — работа компьютера.
 */
export async function requisiteDraftFromSettings(): Promise<Partial<RequisiteFields>> {
  const config = await readPaymentConfig();
  return {
    orgName: config.bizpay_org_name,
    inn: config.bizpay_inn,
    kpp: config.bizpay_kpp,
    bank: config.bizpay_bank,
    bik: config.bizpay_bik,
    account: config.bizpay_account,
    corrAccount: config.bizpay_corr_account,
    purpose: config.bizpay_purpose,
    sbpEnabled: config.bizpay_sbp_enabled === "1",
    sbpPhone: config.bizpay_sbp_phone,
    sbpBank: config.bizpay_sbp_bank,
    sbpRecipient: config.bizpay_sbp_recipient,
    acquiringEnabled: config.bizpay_acquiring_enabled === "1",
    acquiringProvider: config.bizpay_acquiring_provider,
    acquiringLink: config.bizpay_acquiring_link,
    acquiringMerchant: config.bizpay_acquiring_merchant,
    comment: config.bizpay_comment,
    mode: config.bizpay_default_mode || "ONE_TIME",
    period: config.bizpay_default_period || "MONTH",
  };
}
