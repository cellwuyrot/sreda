/**
 * PROJECT-MAIL: учётные данные и адреса почтовых ящиков домена.
 *
 * Почему этот файл вообще нужен. Первая версия раздела только хранила
 * метаданные ящиков и показывала письма, уже лежащие в базе. Но в базу их
 * ничто не клало: письмо приходило на почтовый сервер домена, а приложение
 * о нём не знало. Чтобы админка видела входящие и могла отправлять, нужно
 * подключаться к реальным ящикам: IMAP — читать, SMTP — слать. Здесь живёт
 * вся настройка этих подключений.
 *
 * Пароли ящиков — только из окружения, никогда не в базе и не в коде.
 * Два формата на выбор (можно сочетать):
 *
 *   1) MAIL_ACCOUNTS — JSON вида
 *        {"info":"пароль", "sales":{"user":"sales@trioz.ru","pass":"..."}}
 *      Ключ — localPart. Значение — либо строка-пароль (логин = полный
 *      адрес), либо объект с явным логином.
 *   2) MAIL_ACCOUNT_PASSWORD — один пароль на все ящики (частый случай на
 *      хостинге, когда логин = полный адрес, а пароль выдан общий).
 *
 * Формат (1) имеет приоритет над (2). Если нет ни того ни другого — ящик
 * считается ненастроенным, и операции с ним честно говорят об этом, а не
 * падают молча.
 */

import { mailboxAddress } from "./projectMail";

export interface MailCreds {
  user: string;
  pass: string;
}

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  rejectUnauthorized: boolean;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  rejectUnauthorized: boolean;
}

type Env = Record<string, string | undefined>;

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1";
}

/**
 * Разобрать MAIL_ACCOUNTS. Битый JSON не должен ронять весь модуль — почта
 * не стоит того, чтобы из-за опечатки в env упала вся админка.
 */
export function parseAccounts(env: Env = process.env): Map<string, MailCreds> {
  const map = new Map<string, MailCreds>();
  const raw = env.MAIL_ACCOUNTS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string | { user?: string; pass?: string }>;
      for (const [localPart, val] of Object.entries(parsed)) {
        const key = localPart.trim().toLowerCase();
        if (typeof val === "string") {
          if (val) map.set(key, { user: mailboxAddress(key), pass: val });
        } else if (val && typeof val === "object" && val.pass) {
          map.set(key, { user: val.user || mailboxAddress(key), pass: val.pass });
        }
      }
    } catch {
      console.error("[mail] MAIL_ACCOUNTS: неверный JSON — игнорирую");
    }
  }
  return map;
}

/**
 * Учётные данные конкретного ящика: сначала явно из MAIL_ACCOUNTS, иначе
 * общий пароль MAIL_ACCOUNT_PASSWORD с логином = полный адрес.
 */
export function getAccount(localPart: string, env: Env = process.env): MailCreds | null {
  const key = localPart.trim().toLowerCase();
  const explicit = parseAccounts(env).get(key);
  if (explicit) return explicit;
  const shared = env.MAIL_ACCOUNT_PASSWORD;
  if (shared) return { user: mailboxAddress(key), pass: shared };
  return null;
}

/**
 * IMAP-подключение к хостингу домена. Без MAIL_IMAP_HOST — null: читать
 * почту неоткуда, и об этом надо сказать явно.
 */
export function getImapConfig(env: Env = process.env): ImapConfig | null {
  const host = env.MAIL_IMAP_HOST;
  if (!host) return null;
  const port = parseInt(env.MAIL_IMAP_PORT || "993", 10);
  return {
    host,
    port,
    secure: bool(env.MAIL_IMAP_SECURE, port === 993),
    rejectUnauthorized: env.MAIL_IMAP_TLS_REJECT_UNAUTHORIZED !== "false",
  };
}

/**
 * SMTP-подключение для отправки с ящиков. Отдельный от relay кодов входа:
 * коды шлёт сервис noreply, а клиентская переписка идёт от имени
 * конкретного ящика и требует его логин/пароль. По умолчанию берём
 * MAIL_SMTP_HOST, но если отдельного нет — откатываемся на SMTP_HOST проекта.
 */
export function getSmtpConfig(env: Env = process.env): SmtpConfig | null {
  const host = env.MAIL_SMTP_HOST || env.SMTP_HOST;
  if (!host) return null;
  const port = parseInt(env.MAIL_SMTP_PORT || env.SMTP_PORT || "465", 10);
  return {
    host,
    port,
    secure: bool(env.MAIL_SMTP_SECURE ?? env.SMTP_SECURE, port === 465),
    rejectUnauthorized: env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false",
  };
}
