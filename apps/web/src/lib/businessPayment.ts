/**
 * BUSINESS-PAY: счёт по деловому разговору — общие типы, статусы и разбор документов.
 *
 * ── Зачем отдельный модуль ──────────────────────────────────────────────
 *
 * Счёт читают четыре места: шапка диалога (кнопка «Оплачено / Не оплачено»),
 * модалка клиента, подраздел «Бизнес» в админке и серверные маршруты. Правило
 * «что значит каждый статус и что по нему можно делать» должно быть в ОДНОМ месте:
 * разошедшиеся копии здесь означают не косметическую ошибку, а деньги: клиенту
 * показалось «Оплачено», а администрация ждёт поступления.
 *
 * Модуль не трогает базу и не импортирует Prisma — его можно тянуть и в клиентские
 * компоненты, и в тесты без сгенерированного клиента.
 */

/** Жизненный цикл счёта. Порядок в массиве — это и есть порядок шагов. */
export const PAYMENT_STATUSES = ["UNPAID", "SIGNED", "AWAITING", "PAID"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === "string" && (PAYMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Считается ли счёт оплаченным.
 *
 * Только PAID. AWAITING (клиент нажал «Я оплатил») оплатой НЕ является: иначе
 * любой желающий открывал бы доступ к договорам одной кнопкой, не заплатив ничего.
 */
export function isPaid(status: string | null | undefined): boolean {
  return status === "PAID";
}

/** Подписаны ли документы — то есть можно ли переходить к оплате. */
export function isSigned(status: string | null | undefined): boolean {
  return status === "SIGNED" || status === "AWAITING" || status === "PAID";
}

/** Подпись кнопки в шапке диалога. */
export function statusLabel(status: string | null | undefined): string {
  switch (status) {
    case "PAID":
      return "Оплачено";
    case "AWAITING":
      return "Проверяем оплату";
    case "SIGNED":
      return "К оплате";
    default:
      return "Не оплачено";
  }
}

/**
 * Документ, приложенный к услуге и скопированный в счёт.
 *
 * `uploadedAt` — строка ISO, а не Date: это содержимое колонки Json, и после
 * сериализации там всё равно окажется строка. Пусть тип говорит правду.
 */
export interface ServiceDocument {
  id: string;
  name: string;
  url: string;
  size: number;
  mime: string | null;
  uploadedAt: string;
}

/** Больше не нужно: десяток бумаг на одну услугу — уже признак беспорядка. */
export const MAX_DOCUMENTS = 10;
export const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10 МБ

/**
 * Разрешённые типы договоров.
 *
 * Картинки тоже разрешены: подписанный экземпляр чаще всего снимают телефоном, и
 * требовать от клиента сканер значит получить тот же снимок, но сообщением в чат,
 * где он потеряется. Исполняемых и архивов здесь нет сознательно.
 */
export const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/rtf",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const DOCUMENT_EXTENSIONS = [
  "pdf", "doc", "docx", "rtf", "txt", "jpg", "jpeg", "png", "webp",
] as const;

export function isAllowedDocument(mime: string, filename: string): boolean {
  if ((DOCUMENT_MIME_TYPES as readonly string[]).includes(mime)) return true;
  /* Запасной путь по расширению: браузеры и мобильные клиенты регулярно
     отдают .docx с пустым или application/octet-stream типом. Отказывать человеку
     в загрузке договора из-за каприза его системы нельзя. */
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return (DOCUMENT_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Привести содержимое колонки Json к списку документов.
 *
 * Всё, что не похоже на документ, молча отбрасывается: в Json-колонке может лежать
 * что угодно — старый формат, ручная правка в базе, null. Падать из-за этого всей
 * страницей хуже, чем показать на один документ меньше.
 */
export function parseDocuments(raw: unknown): ServiceDocument[] {
  if (!Array.isArray(raw)) return [];
  const out: ServiceDocument[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id : "";
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    const url = typeof rec.url === "string" ? rec.url : "";
    if (!id || !name || !url) continue;
    out.push({
      id,
      name: name.slice(0, 255),
      url,
      size: typeof rec.size === "number" && rec.size > 0 ? Math.round(rec.size) : 0,
      mime: typeof rec.mime === "string" && rec.mime ? rec.mime.slice(0, 128) : null,
      uploadedAt: typeof rec.uploadedAt === "string" ? rec.uploadedAt : new Date(0).toISOString(),
    });
    if (out.length >= MAX_DOCUMENTS) break;
  }
  return out;
}

/**
 * Сумма для показа: копейки → «12 000 ₽».
 *
 * Дробная часть показывается только когда она есть: «12 000,00 ₽» в счёте на ровную
 * сумму выглядит канцелярски и ничего не уточняет.
 */
export function formatAmount(amountKopecks: number, currency = "RUB"): string {
  const value = (amountKopecks ?? 0) / 100;
  const fractionDigits = Number.isInteger(value) ? 0 : 2;
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    /* Неизвестный код валюты — Intl бросает исключение. Сумму всё равно надо показать. */
    return `${value.toLocaleString("ru-RU")} ${currency}`;
  }
}

/** Размер файла для списка документов. */
export function formatSize(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

/**
 * Счёт в том виде, в каком его отдают маршруты и показывает интерфейс.
 *
 * `documents` и `contracts` приходят ТОЛЬКО тому, кому положено (см. маршрут):
 * документы — участникам разговора, договоры — только после оплаты.
 */
export interface BusinessPaymentView {
  id: string;
  conversationId: string;
  serviceId: string | null;
  serviceTitle: string | null;
  title: string;
  description: string | null;
  amount: number;
  currency: string;
  requisites: string | null;
  status: PaymentStatus;
  /* BUSINESS-SUB: способ выставления и состояние подписки. Правила переходов
     живут в businessPaymentFlow.ts — здесь только форма данных. */
  mode: "ONE_TIME" | "SUBSCRIPTION";
  period: "MONTH" | "QUARTER" | "YEAR" | null;
  cycles: number | null;
  paidCycles: number;
  nextDueAt: string | null;
  /** Наступил ли срок очередного платежа — считает сервер, не браузер. */
  dueNow: boolean;
  documents: ServiceDocument[];
  signedAt: string | null;
  signedName: string | null;
  declaredAt: string | null;
  declaredNote: string | null;
  paidAt: string | null;
  createdAt: string;
  contracts: BusinessContractView[];
}

export interface BusinessContractView {
  id: string;
  name: string;
  url: string;
  size: number;
  mime: string | null;
  uploadedByName: string | null;
  /** Загрузил ли его тот, кто сейчас смотрит, — только своё можно удалить. */
  mine: boolean;
  createdAt: string;
}
