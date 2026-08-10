/**
 * PREMIUM-PAY / BUSINESS-SUB: платёжные реквизиты проекта.
 *
 * Данные заполняет администратор в админ-панели (/admin/payments) и хранятся
 * они в таблице SiteConfig (key/value), как и настройки ИИ-ассистента.
 *
 * ── Почему две независимые группы реквизитов ─────────────────────────
 *
 * Подписку Premium покупает физическое лицо на небольшую сумму — здесь уместны
 * СБП по номеру телефона и платёжная ссылка. Бизнес платит по счёту с юрлица:
 * там Р/С, ИНН, КПП, БИК и назначение платежа, и перевод на телефон физлица
 * бухгалтерию не устроит. Поэтому две группы — не дублирование, а разные
 * способы принять деньги. Флаг `bizpay_same_as_premium` оставлен для тех, кому
 * второй набор не нужен.
 *
 * Секретные ключи эквайринга шифруются (AES-256-GCM) — так же, как ai_api_key.
 */
import prisma from "@/lib/prisma";
import { encrypt, decrypt, isEncrypted } from "@/lib/encryption";

/** Реквизиты Premium (исторические ключи — переименованию не подлежат). */
export const PREMIUM_PAYMENT_KEYS = [
  "premium_price_month",
  "premium_currency",
  "pay_sbp_enabled",
  "pay_sbp_phone",
  "pay_sbp_bank",
  "pay_sbp_recipient",
  "pay_sbp_comment",
  "pay_acquiring_enabled",
  "pay_acquiring_provider",
  "pay_acquiring_link",
  "pay_acquiring_merchant",
  "pay_acquiring_secret",
  "pay_acquiring_comment",
] as const;

/** Реквизиты для счетов бизнеса и параметры по умолчанию для подписки. */
export const BUSINESS_PAYMENT_KEYS = [
  "bizpay_same_as_premium",
  "bizpay_org_name",
  "bizpay_inn",
  "bizpay_kpp",
  "bizpay_bank",
  "bizpay_bik",
  "bizpay_account",
  "bizpay_corr_account",
  "bizpay_purpose",
  "bizpay_sbp_enabled",
  "bizpay_sbp_phone",
  "bizpay_sbp_bank",
  "bizpay_sbp_recipient",
  "bizpay_acquiring_enabled",
  "bizpay_acquiring_provider",
  "bizpay_acquiring_link",
  "bizpay_acquiring_merchant",
  "bizpay_acquiring_secret",
  "bizpay_comment",
  "bizpay_default_mode",
  "bizpay_default_period",
] as const;

/** Все ключи платёжных настроек в SiteConfig. */
export const PAYMENT_KEYS = [
  ...PREMIUM_PAYMENT_KEYS,
  ...BUSINESS_PAYMENT_KEYS,
] as const;

export type PaymentKey = (typeof PAYMENT_KEYS)[number];

/** Ключи, значение которых хранится в зашифрованном виде. */
export const PAYMENT_SECRET_KEYS: PaymentKey[] = [
  "pay_acquiring_secret",
  "bizpay_acquiring_secret",
];

export const PAYMENT_DEFAULTS: Record<PaymentKey, string> = {
  premium_price_month: "",
  premium_currency: "RUB",
  pay_sbp_enabled: "0",
  pay_sbp_phone: "",
  pay_sbp_bank: "",
  pay_sbp_recipient: "",
  pay_sbp_comment: "",
  pay_acquiring_enabled: "0",
  pay_acquiring_provider: "",
  pay_acquiring_link: "",
  pay_acquiring_merchant: "",
  pay_acquiring_secret: "",
  pay_acquiring_comment: "",

  bizpay_same_as_premium: "0",
  bizpay_org_name: "",
  bizpay_inn: "",
  bizpay_kpp: "",
  bizpay_bank: "",
  bizpay_bik: "",
  bizpay_account: "",
  bizpay_corr_account: "",
  bizpay_purpose: "",
  bizpay_sbp_enabled: "0",
  bizpay_sbp_phone: "",
  bizpay_sbp_bank: "",
  bizpay_sbp_recipient: "",
  bizpay_acquiring_enabled: "0",
  bizpay_acquiring_provider: "",
  bizpay_acquiring_link: "",
  bizpay_acquiring_merchant: "",
  bizpay_acquiring_secret: "",
  bizpay_comment: "",
  bizpay_default_mode: "ONE_TIME",
  bizpay_default_period: "MONTH",
};

/**
 * Полная конфигурация платежей (расшифрованная). Только для серверного кода
 * и админ-API — секреты наружу не отдаём в открытом виде.
 */
export async function readPaymentConfig(): Promise<Record<PaymentKey, string>> {
  const rows = await prisma.siteConfig.findMany({ where: { key: { in: [...PAYMENT_KEYS] } } });
  const config = { ...PAYMENT_DEFAULTS };
  for (const row of rows) {
    const key = row.key as PaymentKey;
    if (!(key in config)) continue;
    if (PAYMENT_SECRET_KEYS.includes(key) && row.value) {
      try {
        config[key] = isEncrypted(row.value) ? decrypt(row.value) : row.value;
      } catch {
        config[key] = "";
      }
    } else {
      config[key] = row.value;
    }
  }
  return config;
}

export interface PublicPaymentMethod {
  id: "sbp" | "acquiring" | "invoice";
  label: string;
  fields: { label: string; value: string }[];
  /** Ссылка на оплату (для эквайринга). */
  link?: string;
  comment?: string;
}

export interface PublicPaymentMethods {
  priceMonth: string;
  currency: string;
  methods: PublicPaymentMethod[];
}

/**
 * Публичное представление платёжных способов Premium (без секретов).
 * Возвращаются только включённые администратором способы.
 */
export async function readPublicPaymentMethods(): Promise<PublicPaymentMethods> {
  const config = await readPaymentConfig();
  const methods: PublicPaymentMethod[] = [];

  if (config.pay_sbp_enabled === "1" && config.pay_sbp_phone) {
    methods.push({
      id: "sbp",
      label: "СБП-перевод",
      fields: [
        { label: "Телефон", value: config.pay_sbp_phone },
        { label: "Банк", value: config.pay_sbp_bank },
        { label: "Получатель", value: config.pay_sbp_recipient },
      ].filter((f) => f.value),
      comment: config.pay_sbp_comment || undefined,
    });
  }

  if (config.pay_acquiring_enabled === "1" && (config.pay_acquiring_link || config.pay_acquiring_provider)) {
    methods.push({
      id: "acquiring",
      label: "Интернет-эквайринг",
      fields: [
        { label: "Провайдер", value: config.pay_acquiring_provider },
      ].filter((f) => f.value),
      link: config.pay_acquiring_link || undefined,
      comment: config.pay_acquiring_comment || undefined,
    });
  }

  return {
    priceMonth: config.premium_price_month,
    currency: config.premium_currency || "RUB",
    methods,
  };
}

/**
 * BUSINESS-SUB: способы оплаты для счетов бизнеса (без секретов).
 *
 * При включённом флаге «как у Premium» возвращаются реквизиты Premium: две копии
 * одних и тех же данных расходятся быстрее, чем кажется.
 */
export async function readBusinessPaymentMethods(): Promise<PublicPaymentMethod[]> {
  const config = await readPaymentConfig();

  if (config.bizpay_same_as_premium === "1") {
    const premium = await readPublicPaymentMethods();
    return premium.methods;
  }

  const methods: PublicPaymentMethod[] = [];

  const invoiceFields = [
    { label: "Получатель", value: config.bizpay_org_name },
    { label: "ИНН", value: config.bizpay_inn },
    { label: "КПП", value: config.bizpay_kpp },
    { label: "Банк", value: config.bizpay_bank },
    { label: "БИК", value: config.bizpay_bik },
    { label: "Р/Счёт", value: config.bizpay_account },
    { label: "Корр. счёт", value: config.bizpay_corr_account },
    { label: "Назначение платежа", value: config.bizpay_purpose },
  ].filter((f) => f.value);

  if (invoiceFields.length > 0) {
    methods.push({
      id: "invoice",
      label: "Оплата по счёту",
      fields: invoiceFields,
      comment: config.bizpay_comment || undefined,
    });
  }

  if (config.bizpay_sbp_enabled === "1" && config.bizpay_sbp_phone) {
    methods.push({
      id: "sbp",
      label: "СБП-перевод",
      fields: [
        { label: "Телефон", value: config.bizpay_sbp_phone },
        { label: "Банк", value: config.bizpay_sbp_bank },
        { label: "Получатель", value: config.bizpay_sbp_recipient },
      ].filter((f) => f.value),
    });
  }

  if (
    config.bizpay_acquiring_enabled === "1" &&
    (config.bizpay_acquiring_link || config.bizpay_acquiring_provider)
  ) {
    methods.push({
      id: "acquiring",
      label: "Интернет-эквайринг",
      fields: [{ label: "Провайдер", value: config.bizpay_acquiring_provider }].filter((f) => f.value),
      link: config.bizpay_acquiring_link || undefined,
    });
  }

  return methods;
}

/**
 * Реквизиты бизнеса одним текстом — чтобы подставить в счёт, где администратор
 * не ввёл свои вручную. Персональные реквизиты в счёте всегда главнее общих:
 * бывает, что конкретного клиента ведут через другое юрлицо.
 */
export async function readBusinessRequisitesText(): Promise<string> {
  const methods = await readBusinessPaymentMethods();
  if (methods.length === 0) return "";
  const blocks = methods.map((m) => {
    const lines = m.fields.map((f) => `${f.label}: ${f.value}`);
    if (m.link) lines.push(`Ссылка: ${m.link}`);
    if (m.comment) lines.push(m.comment);
    return [m.label, ...lines].join("\n");
  });
  return blocks.join("\n\n");
}

/** Значение SiteConfig для записи (с шифрованием секретов). */
export function encodePaymentValue(key: PaymentKey, value: string): string {
  if (PAYMENT_SECRET_KEYS.includes(key) && value) return encrypt(value);
  return value;
}
