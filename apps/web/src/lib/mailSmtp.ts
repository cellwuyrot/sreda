/**
 * PROJECT-MAIL: отправка письма от имени конкретного ящика домена.
 *
 * Почему отдельно от lib/email.ts. Там отправка всегда идёт от noreply и
 * предназначена для кодов входа — односторонняя служебная почта. Клиентская
 * переписка должна уходить от реального адреса (support@, sales@…), чтобы
 * клиент мог ответить, и через логин/пароль этого ящика — иначе релей
 * отклонит письмо как подмену отправителя.
 */

import nodemailer from "nodemailer";
import { getSmtpConfig, getAccount } from "./mailAccounts";
import { mailboxAddress, findMailbox } from "./projectMail";

export interface SmtpAttachment {
  filename: string;
  contentBase64: string;
  contentType?: string;
  cid?: string;
}

export interface SendFromMailboxInput {
  to: string;
  subject: string;
  text: string;
  html?: string | null;
  cc?: string;
  bcc?: string;
  fromName?: string;
  inReplyTo?: string | null;
  attachments?: SmtpAttachment[];
  inlineImages?: SmtpAttachment[];
}

export interface SendResult {
  ok: boolean;
  messageId: string | null;
  error?: string;
}

/**
 * Отправить письмо от ящика localPart. Не бросает: возвращает { ok:false, error }
 * — роут сам решает, какой статус отдать и что показать админу.
 */
export async function sendFromMailbox(
  localPart: string,
  input: SendFromMailboxInput,
): Promise<SendResult> {
  const def = findMailbox(localPart);
  if (!def) return { ok: false, messageId: null, error: "unknown mailbox" };

  const config = getSmtpConfig();
  if (!config) return { ok: false, messageId: null, error: "SMTP не настроен: задайте MAIL_SMTP_HOST или SMTP_HOST" };

  const creds = getAccount(def.localPart);
  if (!creds) return { ok: false, messageId: null, error: "Нет учётных данных: задайте MAIL_ACCOUNTS или MAIL_ACCOUNT_PASSWORD" };

  const address = mailboxAddress(def.localPart);
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: creds.user, pass: creds.pass },
    tls: { rejectUnauthorized: config.rejectUnauthorized },
  });

  try {
    const allAttachments = [
      ...(input.attachments || []).map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.contentBase64, "base64"),
        ...(a.contentType ? { contentType: a.contentType } : {}),
      })),
      ...(input.inlineImages || []).map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.contentBase64, "base64"),
        cid: a.cid,
        ...(a.contentType ? { contentType: a.contentType } : {}),
      })),
    ];
    const info = await transport.sendMail({
      from: { name: input.fromName || `TrioZ — ${def.label}`, address },
      to: input.to,
      ...(input.cc ? { cc: input.cc } : {}),
      ...(input.bcc ? { bcc: input.bcc } : {}),
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
      ...(input.inReplyTo ? { inReplyTo: input.inReplyTo, references: input.inReplyTo } : {}),
      ...(allAttachments.length ? { attachments: allAttachments } : {}),
      headers: { "X-Mailer": "TrioZ Ecosystem" },
    });
    return { ok: true, messageId: info.messageId || null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[mail] отправка с ${address} не удалась:`, message);
    return { ok: false, messageId: null, error: message };
  }
}
