import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { mailboxAddress, findMailbox, previewFromText } from "@/lib/projectMail";
import { sendFromMailbox } from "@/lib/mailSmtp";
import { logAction } from "@/lib/audit";

/**
 * PROJECT-MAIL: отправка письма от имени ящика домена.
 *
 * Это вторая половина ответа на «не могу отправлять с этих почт»: админ
 * пишет письмо (например, на noperight81@gmail.com), мы шлём его через SMTP
 * этого ящика и сразу пишем в историю как исходящее.
 *
 * Тело: { to, subject, text, html? }.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ address: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { address } = await ctx.params;
  const def = findMailbox(address);
  if (!def) {
    return NextResponse.json({ error: "Unknown mailbox" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const to = typeof body?.to === "string" ? body.to.trim() : "";
  const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
  const text = typeof body?.text === "string" ? body.text : "";
  const html = typeof body?.html === "string" && body.html ? body.html : null;

  // Простая валидация: адрес получателя и тема/текст обязательны.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return NextResponse.json({ error: "Неверный адрес получателя" }, { status: 400 });
  }
  if (!subject) {
    return NextResponse.json({ error: "Укажите тему" }, { status: 400 });
  }
  if (!text && !html) {
    return NextResponse.json({ error: "Пустое письмо" }, { status: 400 });
  }

  const result = await sendFromMailbox(def.localPart, { to, subject, text, html });
  if (!result.ok) {
    return NextResponse.json({ error: result.error || "Отправка не удалась" }, { status: 502 });
  }

  // Ящик мог ещё не посеяться — создаём лениво, чтобы было куда привязать письмо.
  const mailbox = await prisma.projectMailbox.upsert({
    where: { localPart: def.localPart },
    update: {},
    create: {
      address: mailboxAddress(def.localPart),
      localPart: def.localPart,
      label: def.label,
      purpose: def.purpose,
      order: def.order,
    },
  });

  const saved = await prisma.mailMessage.create({
    data: {
      mailboxId: mailbox.id,
      direction: "outgoing",
      fromAddr: mailboxAddress(def.localPart),
      toAddr: to,
      subject,
      preview: previewFromText(text || subject),
      bodyText: text,
      bodyHtml: html,
      messageId: result.messageId,
      sentAt: new Date(),
    },
  });

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "admin",
    action: "create",
    target: "MailMessage",
    targetId: saved.id,
    details: `Отправлено письмо с ${mailboxAddress(def.localPart)} на ${to}`,
  });

  return NextResponse.json({ ok: true, id: saved.id, messageId: result.messageId });
}
