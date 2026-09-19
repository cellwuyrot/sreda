/**
 * PROJECT-MAIL: почтовые ящики домена trioz.ru, привязанные к проекту.
 *
 * Проект уже отправляет почту (коды входа) через собственный почтовый сервис
 * (`github.com/acoulbot/smtp`, см. `lib/email.ts`). Тот же домен позволяет
 * завести отдельные ящики для общения с клиентами и партнёрами — здесь их
 * единый список-источник правды: он же наполняет базу в seed и он же
 * показывается в админ-панели («Сервисы и система» → «Email и обработка
 * данных»).
 *
 * Список намеренно захардкожен, а не редактируется из UI: адреса создаются на
 * хостинге домена руками, и произвольное добавление ящика в базе без реального
 * ящика на сервере только вводило бы в заблуждение. Меняется список редко и
 * вместе с настройкой домена — значит, его место в коде рядом с миграцией.
 */

import { createHash } from "crypto";

export interface MailboxDef {
  /** Часть до @ — используется как стабильный идентификатор в маршрутах. */
  localPart: string;
  /** Короткая подпись ящика для списка. */
  label: string;
  /** Для чего ящик — текст из брифа домена. */
  purpose: string;
  order: number;
}

/** Домен проекта. Один на все ящики — держим отдельно, чтобы не повторять. */
export const MAIL_DOMAIN = "trioz.ru";

/**
 * Девять рабочих ящиков домена. Порядок = порядок показа в интерфейсе.
 * Тексты назначения — дословно из утверждённого брифа.
 */
export const PROJECT_MAILBOXES: readonly MailboxDef[] = [
  { localPart: "info", label: "Общие вопросы", purpose: "Общие вопросы", order: 0 },
  { localPart: "sales", label: "Продажи", purpose: "Коммерция, КП, продажи", order: 1 },
  { localPart: "support", label: "Поддержка", purpose: "Поддержка клиентов", order: 2 },
  { localPart: "legal", label: "Юридические вопросы", purpose: "Юридические вопросы и персональные данные", order: 3 },
  { localPart: "docs", label: "Документы", purpose: "Счета, акты, закрывающие документы", order: 4 },
  { localPart: "partners", label: "Партнёры", purpose: "Реселлеры, интеграторы, агентства", order: 5 },
  { localPart: "hr", label: "HR отдел", purpose: "Подбор и работа с персоналом", order: 6 },
  { localPart: "media", label: "PR отдел", purpose: "Пресса, публикации, медиа", order: 7 },
  { localPart: "security", label: "Безопасность", purpose: "Сообщения об уязвимостях", order: 8 },
] as const;

/** Полный адрес ящика: info → info@trioz.ru. */
export function mailboxAddress(localPart: string): string {
  return `${localPart}@${MAIL_DOMAIN}`;
}

/** Найти определение ящика по localPart (регистр не важен). */
export function findMailbox(localPart: string): MailboxDef | undefined {
  const key = localPart.trim().toLowerCase();
  return PROJECT_MAILBOXES.find((m) => m.localPart === key);
}

/** Направление письма в листинге. */
export type MailDirection = "incoming" | "outgoing";

export function isMailDirection(value: unknown): value is MailDirection {
  return value === "incoming" || value === "outgoing";
}

/**
 * Ключ дедупликации для письма без RFC Message-ID.
 *
 * Дедуп в опросе IMAP и в вебхуке раньше стоял под условием «если Message-ID
 * есть». Письма без него (а их присылают и рассылочные движки, и часть
 * корпоративных релеев) пересоздавались при каждом опросе: счётчики ящика
 * росли от каждого нажатия, а история заполнялась копиями одного письма.
 *
 * Поэтому, когда настоящего Message-ID нет, считаем его сами — от полей,
 * которые у одного и того же письма не меняются между опросами: ящик,
 * отправитель, тема, дата и тело. Формат намеренно отличается от RFC-адреса
 * (`synthetic:<hash>`), чтобы в базе было видно, что это наш ключ, а не
 * заголовок письма.
 */
export function syntheticMessageId(parts: {
  localPart: string;
  fromAddr: string;
  subject: string;
  sentAt: Date;
  bodyText: string;
}): string {
  const material = [
    parts.localPart,
    parts.fromAddr,
    parts.subject,
    parts.sentAt.toISOString(),
    parts.bodyText,
  ].join("\u0000");
  return `synthetic:${createHash("sha256").update(material, "utf8").digest("hex")}`;
}

/**
 * Нарушение уникального индекса Prisma (P2002).
 *
 * Для почты это не сбой, а «такое письмо уже есть»: опрос по кнопке и опрос по
 * cron могут дойти до записи одновременно, и второй обязан спокойно посчитать
 * письмо дублем, а не уронить весь опрос ящика.
 */
export function isUniqueViolation(error: unknown): boolean {
  return Boolean(error) && (error as { code?: unknown }).code === "P2002";
}

/** Размер страницы листинга по умолчанию. */
export const MAIL_PAGE_SIZE = 25;

/**
 * Потолок размера страницы. Ограничение не от жадности клиента, а от размера
 * ответа: в строке листинга едет ещё и preview на 160 символов.
 */
export const MAIL_PAGE_SIZE_MAX = 100;

/**
 * Сколько последних писем ящика читаем из INBOX за один опрос. Раньше здесь
 * стоял размер листинга (10) — и история глубже десяти писем не попадала в
 * базу вообще. Опрос идёт по расписанию и по кнопке, дубли отсекаются по
 * ключу дедупликации, поэтому окно можно держать заметно шире.
 */
export const MAIL_IMAP_FETCH_LIMIT = 100;

/**
 * Короткий предпросмотр тела письма для строки списка. Схлопывает переносы и
 * пробелы, режет до `max` символов и добавляет многоточие — чтобы список не
 * разъезжался от длинных писем.
 */
export function previewFromText(text: string, max = 160): string {
  const flat = (text || "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** Данные письма, которых достаточно, чтобы собрать .eml для скачивания. */
export interface EmlSource {
  fromAddr: string;
  toAddr: string;
  subject: string;
  sentAt: Date;
  bodyText: string;
  bodyHtml?: string | null;
  messageId?: string | null;
}

/** RFC 2047 — кодируем не-ASCII заголовки в UTF-8 base64, иначе тема бьётся. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  const b64 = Buffer.from(value, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

/**
 * Собрать письмо в формат .eml (RFC 822) для скачивания. Если есть HTML-тело,
 * пишем multipart/alternative, иначе — простой текст. Тело кодируем base64,
 * чтобы кириллица и длинные строки не портились при выгрузке.
 */
export function buildEml(msg: EmlSource): string {
  const date = msg.sentAt.toUTCString().replace(/GMT$/, "+0000");
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const headers: string[] = [
    "MIME-Version: 1.0",
    `Date: ${date}`,
    `From: ${encodeHeader(msg.fromAddr)}`,
    `To: ${encodeHeader(msg.toAddr)}`,
    `Subject: ${encodeHeader(msg.subject)}`,
  ];
  if (msg.messageId) headers.push(`Message-ID: <${msg.messageId.replace(/[<>]/g, "")}>`);

  if (msg.bodyHtml) {
    const boundary = "trioz-eml-boundary";
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const parts = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      b64(msg.bodyText || ""),
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      b64(msg.bodyHtml),
      `--${boundary}--`,
      "",
    ];
    return `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}`;
  }

  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push("Content-Transfer-Encoding: base64");
  return `${headers.join("\r\n")}\r\n\r\n${b64(msg.bodyText || "")}\r\n`;
}

/** Имя файла для скачивания письма — безопасное, без пробелов и кириллицы в ФС. */
export function emlFileName(id: string): string {
  return `trioz-mail-${id}.eml`;
}
