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
import { mailboxAddress } from "./projectMail";
import { normalizeParsed, type NormalizedIncoming } from "./mailNormalize";

/**
 * Забрать последние письма ящика по IMAP. Ошибка конкретного ящика не
 * должна ронять опрос остальных — поэтому бросаем осмысленное исключение,
 * а решение «продолжать ли» принимает вызывающая сторона (poll-роут).
 */
export type ImapIncoming = NormalizedIncoming & { imapUid: number };
export type ImapSyncBatch = {
  messages: ImapIncoming[];
  uidValidity: bigint | null;
};

export async function fetchSinceUid(
  localPart: string,
  lastSyncedUid: bigint | number | null = null,
  previousUidValidity: bigint | number | null = null,
): Promise<ImapSyncBatch> {
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

  const out: ImapIncoming[] = [];
  let uidValidity: bigint | null = null;
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const status = client.mailbox;
      const total = status && typeof status !== "boolean" ? status.exists : 0;
      uidValidity = status && typeof status !== "boolean" && status.uidValidity != null
        ? BigInt(status.uidValidity)
        : null;
      const validityChanged = previousUidValidity != null && uidValidity != null
        && BigInt(previousUidValidity) !== uidValidity;
      const fromUid = validityChanged ? BigInt(1) : BigInt(lastSyncedUid || 0) + BigInt(1);
      if (total > 0) {
        for await (const msg of client.fetch(`${fromUid}:*`, { uid: true, source: true }, { uid: true })) {
          if (!msg.source) continue;
          const parsed = await simpleParser(msg.source);
          out.push({
            ...normalizeParsed(parsed, mailboxAddress(localPart)),
            imapUid: Number(msg.uid),
          });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  // Cursor продвигается по UID, поэтому обработка должна идти строго по возрастанию.
  return { messages: out.sort((a, b) => a.imapUid - b.imapUid), uidValidity };
}

/** Backward-compatible helper for callers outside poll; no 100-message cap. */
export async function fetchRecent(localPart: string): Promise<NormalizedIncoming[]> {
  const batch = await fetchSinceUid(localPart);
  return batch.messages.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
}
