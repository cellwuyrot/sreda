/**
 * PROJECT-MAIL: отправка письма от имени конкретного ящика домена.
 */
import nodemailer from "nodemailer";
import { getSmtpConfig, getAccount } from "./mailAccounts";
import { mailboxAddress, findMailbox } from "./projectMail";

export interface SendFromMailboxInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  fromName?: string;
  subject: string;
  text?: string;
  html?: string | null;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string; cid?: string }>;
  inReplyTo?: string;
}

export interface SendResult {
  ok: boolean;
  messageId: string | null;
  error?: string;
}

export async function sendFromMailbox(localPart: string, input: SendFromMailboxInput): Promise<SendResult> {
  const def = findMailbox(localPart);
  if (!def) return { ok: false, messageId: null, error: "unknown mailbox" };
  const config = getSmtpConfig();
  if (!config) return { ok: false, messageId: null, error: "SMTP не настроен: задайте MAIL_SMTP_HOST или SMTP_HOST" };
  const creds = getAccount(def.localPart);
  if (!creds) return { ok: false, messageId: null, error: "Нет учётных данных: задайте MAIL_ACCOUNTS или MAIL_ACCOUNT_PASSWORD" };
  const address = mailboxAddress(def.localPart);
  const transport = nodemailer.createTransport({
    host: config.host, port: config.port, secure: config.secure,
    auth: { user: creds.user, pass: creds.pass },
    tls: { rejectUnauthorized: config.rejectUnauthorized },
  });
  const from = input.fromName ? { name: input.fromName, address } : { name: `TrioZ — ${def.label}`, address };
  try {
    const info = await transport.sendMail({
      from,
      to: input.to.join(", "),
      cc: input.cc?.length ? input.cc.join(", ") : undefined,
      bcc: input.bcc?.length ? input.bcc.join(", ") : undefined,
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
      attachments: input.attachments,
      inReplyTo: input.inReplyTo,
      headers: {
        "X-Mailer": "TrioZ Ecosystem",
        ...(input.inReplyTo ? { References: input.inReplyTo } : {}),
      },
    });
    return { ok: true, messageId: info.messageId || null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[mail] отправка с ${address} не удалась:`, message);
    return { ok: false, messageId: null, error: message };
  }
}
