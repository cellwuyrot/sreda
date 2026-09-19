/**
 * PROJECT-MAIL: чистая нормализация разобранного письма в строку базы.
 *
 * Вынесено из mailImap.ts отдельно от сетевого кода (imapflow/mailparser)
 * специально ради тестируемости: здесь нет ни сети, ни внешних
 * зависимостей, поэтому логику разбора можно проверять юнит-тестами
 * без поднятия IMAP.
 */

import type { ParsedMail, AddressObject } from "mailparser";
import { previewFromText, syntheticMessageId } from "./projectMail";

/** Письмо в виде, готовом для записи в базу (MailMessage). */
export interface NormalizedIncoming {
  direction: "incoming";
  fromAddr: string;
  toAddr: string;
  subject: string;
  preview: string;
  bodyText: string;
  bodyHtml: string | null;
  /**
   * Ключ дедупликации: настоящий RFC Message-ID письма, а если его в письме
   * нет — посчитанный нами синтетический (см. syntheticMessageId). Никогда не
   * null: без ключа повторный опрос ящика создавал дубль.
   */
  messageId: string;
  sentAt: Date;
}

/** Подмножество полей ParsedMail, которое реально используем — удобно для тестов. */
export type ParsedLike = Pick<
  ParsedMail,
  "from" | "to" | "subject" | "text" | "html" | "messageId" | "date"
>;

function addressText(addr: AddressObject | AddressObject[] | undefined): string {
  if (!addr) return "";
  const one = Array.isArray(addr) ? addr[0] : addr;
  return one?.text || "";
}

/**
 * Превратить разобранное письмо в строку базы. Чистая функция: никакой сети,
 * никакого process.env. `fallbackTo` — адрес нашего ящика на случай, если
 * в письме поле To пустое (бывает у рассылок).
 */
export function normalizeParsed(parsed: ParsedLike, fallbackTo: string): NormalizedIncoming {
  const bodyText = (parsed.text || "").toString();
  const bodyHtml = typeof parsed.html === "string" ? parsed.html : null;
  const subject = (parsed.subject || "(без темы)").toString().slice(0, 2000);
  const fromAddr = addressText(parsed.from).slice(0, 320);
  const sentAt = parsed.date instanceof Date && !isNaN(parsed.date.getTime()) ? parsed.date : new Date();
  return {
    direction: "incoming",
    fromAddr,
    toAddr: (addressText(parsed.to) || fallbackTo).slice(0, 320),
    subject,
    preview: previewFromText(bodyText || subject),
    bodyText,
    bodyHtml,
    messageId: parsed.messageId
      ? String(parsed.messageId).slice(0, 400)
      : syntheticMessageId({
          localPart: fallbackTo.split("@")[0],
          fromAddr,
          subject,
          sentAt,
          bodyText,
        }),
    sentAt,
  };
}
