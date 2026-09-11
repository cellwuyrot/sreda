import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { findMailbox, mailboxAddress, previewFromText } from "@/lib/projectMail";

/**
 * PROJECT-MAIL: отправка письма с ящика домена (support@, sales@, …).
 *
 * Ключевое: письмо уходит тем же путём, что и коды входа — через
 * почтовый сервис (lib/email.ts). Ключ сервиса привязан к домену, а не к
 * одному адресу, поэтому from_email может быть любым ящиком @trioz.ru —
 * отдельные SMTP-пароли по каждому ящику не нужны. Отправленное
 * письмо сразу пишется в историю ящика как outgoing, чтобы быть видным в
 * админке даже без вебхука от сервиса.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Простое письмо: текст как есть, переносы сохраняем через white-space. */
function textToHtml(text: string): string {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111;white-space:pre-wrap">${escapeHtml(text)}</div>`;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { address } = await ctx.params;
  const def = findMailbox(address);
  if (!def) return NextResponse.json({ error: "Unknown mailbox" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const to = String(body?.to || "").trim();
  const subject = String(body?.subject || "").trim();
  const text = String(body?.text || "").trim();
  if (!EMAIL_RE.test(to)) return NextResponse.json({ error: "Неверный адрес получателя" }, { status: 400 });
  if (!subject) return NextResponse.json({ error: "Тема обязательна" }, { status: 400 });
  if (!text) return NextResponse.json({ error: "Текст письма обязателен" }, { status: 400 });

  const from = mailboxAddress(def.localPart);
  const html = textToHtml(text);

  // Отправляем через тот же почтовый путь, что и коды входа, но от имени ящика.
  const ok = await sendEmail({ from, to, subject, html, text });
  if (!ok) {
    return NextResponse.json(
      {
        error:
          "Почтовый сервис отклонил письмо. Проверьте SMTP_SERVICE_URL/SMTP_SERVICE_KEY и что домен ключа — trioz.ru.",
      },
      { status: 502 },
    );
  }

  // Ящик мог ещё не посеяться — создаём лениво по каноническому определению.
  const mailbox = await prisma.projectMailbox.upsert({
    where: { localPart: def.localPart },
    update: {},
    create: {
      address: from,
      localPart: def.localPart,
      label: def.label,
      purpose: def.purpose,
      order: def.order,
    },
  });

  const created = await prisma.mailMessage.create({
    data: {
      mailboxId: mailbox.id,
      direction: "outgoing",
      fromAddr: from,
      toAddr: to,
      subject: subject.slice(0, 2000),
      preview: previewFromText(text || subject),
      bodyText: text,
      bodyHtml: html,
      sentAt: new Date(),
    },
  });

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "admin",
    action: "create",
    target: "MailMessage",
    targetId: created.id,
    details: `Отправлено письмо с ${from} на ${to}`,
  });

  return NextResponse.json({ ok: true, id: created.id });
}
