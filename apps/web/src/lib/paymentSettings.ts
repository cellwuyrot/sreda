/**
 * PREMIUM-PAY: платёжные реквизиты для покупки Premium.
 *
 * Данные заполняет администратор в админ-панели (/admin/payments) и хранятся
 * они в таблице SiteConfig (key/value), как и настройки ИИ-ассистента. На эти
 * реквизиты клиент отправляет оплату; поддерживаются два способа:
 *   - СБП-перевод (Система быстрых платежей) — по номеру телефона;
 *   - интернет-эквайринг — по платёжной ссылке провайдера.
 *
 * Секретный ключ эквайринга шифруется (AES-256-GCM) — так же, как ai_api_key.
 */
import prisma from "@/lib/prisma";
import { encrypt, decrypt, isEncrypted } from "@/lib/encryption";

/** Все ключи платёжных настроек в SiteConfig. */
export const PAYMENT_KEYS = [
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

export type PaymentKey = (typeof PAYMENT_KEYS)[number];

/** Ключи, значение которых хранится в зашифрованном виде. */
export const PAYMENT_SECRET_KEYS: PaymentKey[] = ["pay_acquiring_secret"];

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
  id: "sbp" | "acquiring";
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
 * Публичное представление платёжных способов для клиента (без секретов).
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

/** Значение SiteConfig для записи (с шифрованием секретов). */
export function encodePaymentValue(key: PaymentKey, value: string): string {
  if (PAYMENT_SECRET_KEYS.includes(key) && value) return encrypt(value);
  return value;
}
