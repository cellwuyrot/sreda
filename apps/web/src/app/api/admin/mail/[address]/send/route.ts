import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { sendFromMailbox } from "@/lib/mailSmtp";
import { findMailbox, mailboxAddress, previewFromText } from "@/lib/projectMail";
import { validateRecipients } from "@/lib/mailRecipients";
import { checkAttachmentSet } from "@/lib/mailAttachments";
import { markdownToHtml, htmlToText } from "@/lib/mailMarkdown";
import { buildEmailHtml, applyVariables } from "@/lib/mailLayout";
import { sanitizeEmailHtml, sanitizeSignatureHtml } from "@/lib/mailSanitize";
import { logMailSend } from "@/lib/mailAudit";
import { logAction } from "@/lib/audit";

export async function POST(req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { address } = await ctx.params;
  const def = findMailbox(decodeURIComponent(address).split("@")[0]);
  if (!def) return NextResponse.json({ error: "Unknown mailbox" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const rc = validateRecipients({
    to: Array.isArray(body?.to) ? body.to : typeof body?.to === "string" ? [body.to] : [],
    cc: Array.isArray(body?.cc) ? body.cc : [],
    bcc: Array.isArray(body?.bcc) ? body.bcc : [],
  });
  if (!rc.ok) return NextResponse.json({ error: rc.error }, { status: 400 });
  const rawSubject = String(body?.subject || "").trim();
  if (!rawSubject) return NextResponse.json({ error: "Укажите тему письма" }, { status: 400 });
  const variables = body?.variables && typeof body.variables === "object" ? body.variables : {};
  const subject = applyVariables(rawSubject, variables).slice(0, 255);
  const format = body?.format === "markdown" ? "markdown" : "html";
  const rawBody = String(body?.body || "");
  if (!rawBody.trim()) return NextResponse.json({ error: "Пустое письмо" }, { status: 400 });
  const contentHtml = format === "markdown"
    ? markdownToHtml(applyVariables(rawBody, variables))
    : applyVariables(rawBody, variables);
  let signatureHtml = "";
  try {
    const sig = await prisma.mailSignature.findUnique({ where: { localPart: def.localPart } });
    if (sig?.enabled) signatureHtml = sanitizeSignatureHtml(sig.html);
  } catch {}
  const innerSafe = sanitizeEmailHtml(contentHtml);
  const fullHtml = buildEmailHtml({ bodyHtml: innerSafe, subject, signatureHtml });
  const safeHtml = sanitizeEmailHtml(fullHtml);
  const plainText = htmlToText(innerSafe) + (signatureHtml ? "\n\n" + htmlToText(signatureHtml) : "");
  const attachments = Array.isArray(body?.attachments) ? body.attachments : [];
  const inlineImages = Array.isArray(body?.inlineImages) ? body.inlineImages : [];
  const allAttachments = [...attachments, ...inlineImages];
  const setCheck = checkAttachmentSet(allAttachments.map((a: any) => ({ name: String(a.name || ""), size: Number(a.size || 0), mime: String(a.mime || "") })));
  if (!setCheck.ok) return NextResponse.json({ error: setCheck.error }, { status: 400 });
  const decode = (raw: unknown) => Buffer.from(String(raw || ""), "base64");
  const mailAttachments = allAttachments.map((a: any) => ({ filename: String(a.name || "attachment"), content: decode(a.content), contentType: String(a.mime || "application/octet-stream"), ...(a.cid ? { cid: String(a.cid) } : {}) }));
  const fromName = String(body?.fromName || "").trim().slice(0, 120);
  const result = await sendFromMailbox(def.localPart, {
    fromName: fromName || undefined,
    to: rc.to, cc: rc.cc, bcc: rc.bcc, subject, html: safeHtml, text: plainText,
    attachments: mailAttachments, inReplyTo: body?.replyToMessageId ? String(body.replyToMessageId) : undefined,
  });
  if (!result.ok) return NextResponse.json({ error: result.error || "Отправка не удалась" }, { status: 502 });

  const mailbox = await prisma.projectMailbox.upsert({
    where: { localPart: def.localPart }, update: {}, create: { address: mailboxAddress(def.localPart), localPart: def.localPart, label: def.label, purpose: def.purpose, order: def.order },
  });
  const meta = allAttachments.map((a: any) => ({ name: String(a.name || ""), size: Number(a.size || 0), mime: String(a.mime || ""), inline: !!a.cid }));
  const saved = await prisma.mailMessage.create({ data: {
    mailboxId: mailbox.id, direction: "outgoing", fromAddr: mailboxAddress(def.localPart), fromName: fromName || null,
    toAddr: rc.to.join(", "), ccAddr: rc.cc.length ? rc.cc.join(", ") : null, bccAddr: rc.bcc.length ? rc.bcc.join(", ") : null,
    subject, preview: previewFromText(plainText || subject), bodyText: plainText, bodyHtml: safeHtml, messageId: result.messageId,
    templateKey: body?.templateKey ? String(body.templateKey) : null, sentById: session.user.id || null,
    sentByName: session.user.name || session.user.email || session.user.username || "admin",
    inReplyToMid: body?.replyToMessageId ? String(body.replyToMessageId) : null, attachmentsMeta: JSON.stringify(meta), sentAt: new Date(),
  }});
  for (const a of allAttachments) {
    await prisma.mailAttachment.create({ data: { messageId: saved.id, name: String(a.name || "attachment"), mime: String(a.mime || "application/octet-stream"), size: Number(a.size || 0), inline: !!a.cid, contentB64: String(a.content || "") } });
  }
  await logMailSend({ userId: session.user.id, userName: session.user.name || session.user.email || session.user.username || "admin", fromAddress: mailboxAddress(def.localPart), fromName: fromName || undefined, to: rc.to, cc: rc.cc, bcc: rc.bcc, subject, attachmentCount: allAttachments.length, templateKey: body?.templateKey ? String(body.templateKey) : undefined, messageDbId: saved.id });
  await logAction({ userId: session.user.id, username: session.user.username || session.user.name || "admin", action: "create", target: "MailMessage", targetId: saved.id, details: `Отправлено письмо с ${mailboxAddress(def.localPart)} на ${rc.to.join(", ")}` });
  const authorId = session.user.id || "admin";
  try { await prisma.mailDraft.deleteMany({ where: { authorId, localPart: def.localPart } }); } catch {}
  return NextResponse.json({ ok: true, id: saved.id, messageId: result.messageId });
}
