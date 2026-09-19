/**
 * PROJECT-MAIL: чтение входящих писем ящика по IMAP.
 *
 * Это тот самый недостающий мост. Письмо приходит на почтовый сервер
 * домена (тот, где заведены info@/sales@/…), а приложение раньше о нём не
 * знало — потому в админке было пусто. Здесь мы подключаемся к ящику,
 * берём последние письма из INBOX и отдаём в нормализованном виде.
 *
 * Сетевая часть (imapflow + mailparser) и чистая нормализация разделены:
 * normalizeParsed() не трогает сеть и потому покрывается юнит-тестами.
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { getImapConfig, getAccount, type MailCreds } from "./mailAccounts";
import { MAIL_IMAP_FETCH_LIMIT, mailboxAddress } from "./projectMail";
import { normalizeParsed, type NormalizedIncoming } from "./mailNormalize";

/**
 * Забрать последние письма ящика по IMAP. Ошибка конкретного ящика не
 * должна ронять опрос остальных — поэтому бросаем осмысленное исключение,
 * а решение «продолжать ли» принимает вызывающая сторона (poll-роут).
 */
export async function fetchRecent(
  localPart: string,
  limit = MAIL_IMAP_FETCH_LIMIT,
): Promise<NormalizedIncoming[]> {
  const config = getImapConfig();
  if (!config) {
    throw new Error("IMAP не настроен: задайте MAIL_IMAP_HOST");
  }
  const creds: MailCreds | null = getAccount(localPart);
  if (!creds) {
    throw new Error(`Нет учётных данных для ящика ${localPart}: задайте MAIL_ACCOUNTS или MAIL_ACCOUNT_PASSWORD`);
  }

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: creds.user, pass: creds.pass },
    tls: { rejectUnauthorized: config.rejectUnauthorized },
    logger: false,
  });

  const out: NormalizedIncoming[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const status = client.mailbox;
      const total = status && typeof status !== "boolean" ? status.exists : 0;
      if (total > 0) {
        const from = Math.max(1, total - limit + 1);
        for await (const msg of client.fetch(`${from}:*`, { source: true })) {
          if (!msg.source) continue;
          const parsed = await simpleParser(msg.source);
          out.push(normalizeParsed(parsed, mailboxAddress(localPart)));
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  // Новые — сверху, как в листинге.
  return out.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
}
