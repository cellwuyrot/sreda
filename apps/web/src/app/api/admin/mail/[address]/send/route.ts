import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { mailboxAddress, findMailbox, previewFromText } from "@/lib/projectMail";
import { sendFromMailbox, type SmtpAttachment } from "@/lib/mailSmtp";
import { logAction } from "@/lib/audit";
import { validateRecipients } from "@/lib/mailRecipients";
import { checkAttachmentSet, type AttachmentMeta } from "@/lib/mailAttachments";
import { markdownToHtml, htmlToText } from "@/lib/mailMarkdown";
import { buildEmailHtml, applyVariables } from "@/lib/mailLayout";
import { sanitizeEmailHtml, sanitizeSignatureHtml } from "@/lib/mailSanitize";
import { logMailSend } from "@/lib/mailAudit";

/**
 * PROJECT-MAIL: \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0430 \u043f\u0438\u0441\u044c\u043c\u0430 \u0447\u0435\u0440\u0435\u0437 \u043a\u043e\u043c\u043f\u043e\u0437\u0435\u0440 (\u043f\u043e\u043b\u0443\u0447\u0430\u0442\u0435\u043b\u0438 To/CC/BCC,
 * \u0442\u0435\u043c\u0430, Rich Text/Markdown, \u0432\u043b\u043e\u0436\u0435\u043d\u0438\u044f, \u043f\u043e\u0434\u043f\u0438\u0441\u044c, \u0448\u0430\u0431\u043b\u043e\u043d\u044b).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { address } = await ctx.params;
  const def = findMailbox(address);
  if (!def) return NextResponse.json({ error: "Unknown mailbox" }, { status: 404 });

  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "\u041d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 \u0437\u0430\u043f\u0440\u043e\u0441" }, { status: 400 });

  const rcpt = validateRecipients({ to: b.to, cc: b.cc, bcc: b.bcc });
  if (!rcpt.ok) return NextResponse.json({ error: rcpt.error }, { status: 400 });

  const subject = typeof b.subject === "string" ? b.subject.trim() : "";
  if (!subject) return NextResponse.json({ error: "\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u0442\u0435\u043c\u0443" }, { status: 400 });
  if (subject.length > 255) return NextResponse.json({ error: "\u0422\u0435\u043c\u0430 \u0434\u043b\u0438\u043d\u043d\u0435\u0435 255 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432" }, { status: 400 });

  const format = b.format === "markdown" ? "markdown" : "html";
  const rawBody = typeof b.body === "string" ? b.body : "";
  const fromName = typeof b.fromName === "string" && b.fromName.trim() ? b.fromName.trim() : undefined;
  const templateKey = typeof b.templateKey === "string" && b.templateKey ? b.templateKey : undefined;
  const variables = (b.variables && typeof b.variables === "object") ? b.variables as Record<string, string> : {};

  const attIn: Array<{ name: string; mime: string; size: number; content: string; cid?: string }> = Array.isArray(b.attachments) ? b.attachments : [];
  const inlineIn: Array<{ name: string; mime: string; size: number; content: string; cid?: string }> = Array.isArray(b.inlineImages) ? b.inlineImages : [];
  const metaAll: AttachmentMeta[] = [...attIn, ...inlineIn].map((a) => ({ name: a.name, size: a.size, mime: a.mime }));
  const attCheck = checkAttachmentSet(metaAll);
  if (!attCheck.ok) return NextResponse.json({ error: attCheck.error }, { status: 400 });

  // \u041f\u0435\u0440\u0435\u043c\u0435\u043d\u043d\u044b\u0435 \u0448\u0430\u0431\u043b\u043e\u043d\u0430 \u2192 \u0442\u0435\u043c\u0430 \u0438 \u0442\u0435\u043b\u043e.
  const subjectFinal = applyVariables(subject, variables);
  const bodyWithVars = applyVariables(rawBody, variables);
  const bodyHtmlRaw = format === "markdown" ? markdownToHtml(bodyWithVars) : bodyWithVars;
  const bodySafe = sanitizeEmailHtml(bodyHtmlRaw);

  // \u041f\u043e\u0434\u043f\u0438\u0441\u044c \u044f\u0449\u0438\u043a\u0430.
  const sig = await prisma.mailSignature.findUnique({ where: { localPart: def.localPart } }).catch(() => null);
  const signatureHtml = sig && sig.enabled && sig.html ? sanitizeSignatureHtml(sig.html) : undefined;

  const fullRaw = buildEmailHtml({ bodyHtml: bodySafe, subject: subjectFinal, signatureHtml });
  const fullHtml = sanitizeEmailHtml(fullRaw);
  const text = htmlToText(bodySafe);

  // Reply: \u043d\u0430\u0445\u043e\u0434\u0438\u043c RFC Message-ID \u0438\u0441\u0445\u043e\u0434\u043d\u043e\u0433\u043e \u043f\u0438\u0441\u044c\u043c\u0430.
  let inReplyTo: string | null = null;
  if (typeof b.replyToMessageId === "string" && b.replyToMessageId) {
    const orig = await prisma.mailMessage.findUnique({ where: { id: b.replyToMessageId } }).catch(() => null);
    inReplyTo = orig?.messageId || null;
  }

  const smtpAttachments: SmtpAttachment[] = attIn.map((a) => ({ filename: a.name, contentBase64: a.content, contentType: a.mime }));
  const smtpInline: SmtpAttachment[] = inlineIn.map((a) => ({ filename: a.name, contentBase64: a.content, contentType: a.mime, cid: a.cid }));

  const result = await sendFromMailbox(def.localPart, {
    to: rcpt.to.join(", "),
    cc: rcpt.cc.length ? rcpt.cc.join(", ") : undefined,
    bcc: rcpt.bcc.length ? rcpt.bcc.join(", ") : undefined,
    subject: subjectFinal,
    text,
    html: fullHtml,
    fromName,
    inReplyTo,
    attachments: smtpAttachments,
    inlineImages: smtpInline,
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error || "\u041e\u0442\u043f\u0440\u0430\u0432\u043a\u0430 \u043d\u0435 \u0443\u0434\u0430\u043b\u0430\u0441\u044c" }, { status: 502 });

  const mailbox = await prisma.projectMailbox.upsert({
    where: { localPart: def.localPart },
    update: {},
    create: { address: mailboxAddress(def.localPart), localPart: def.localPart, label: def.label, purpose: def.purpose, order: def.order },
  });

  const saved = await prisma.mailMessage.create({
    data: {
      mailboxId: mailbox.id,
      direction: "outgoing",
      fromAddr: mailboxAddress(def.localPart),
      fromName: fromName || null,
      toAddr: rcpt.to.join(", "),
      ccAddr: rcpt.cc.length ? rcpt.cc.join(", ") : null,
      bccAddr: rcpt.bcc.length ? rcpt.bcc.join(", ") : null,
      subject: subjectFinal,
      preview: previewFromText(text || subjectFinal),
      bodyText: text,
      bodyHtml: fullHtml,
      attachmentsMeta: metaAll.length ? JSON.stringify(metaAll) : null,
      templateKey: templateKey || null,
      sentById: session.user.id,
      sentByName: session.user.username || session.user.name || "admin",
      inReplyToMid: inReplyTo,
      messageId: result.messageId,
      sentAt: new Date(),
    },
  });

  const allFiles = [...attIn.map((a) => ({ ...a, inline: false })), ...inlineIn.map((a) => ({ ...a, inline: true }))];
  if (allFiles.length) {
    await prisma.mailAttachment.createMany({
      data: allFiles.map((a) => ({ messageId: saved.id, name: a.name, mime: a.mime, size: a.size, inline: a.inline, contentB64: a.content })),
    });
  }

  await logMailSend({
    userId: session.user.id,
    userName: session.user.username || session.user.name || "admin",
    fromAddress: mailboxAddress(def.localPart),
    fromName,
    to: rcpt.to, cc: rcpt.cc, bcc: rcpt.bcc,
    subject: subjectFinal, attachmentCount: allFiles.length, templateKey, messageDbId: saved.id,
  });
  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "admin",
    action: "create", target: "MailMessage", targetId: saved.id,
    details: `\u041e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e \u043f\u0438\u0441\u044c\u043c\u043e \u0441 ${mailboxAddress(def.localPart)} \u043d\u0430 ${rcpt.to.join(", ")}`,
  });

  // \u0427\u0435\u0440\u043d\u043e\u0432\u0438\u043a \u044d\u0442\u043e\u0433\u043e \u0430\u0432\u0442\u043e\u0440\u0430+\u044f\u0449\u0438\u043a\u0430 \u0431\u043e\u043b\u044c\u0448\u0435 \u043d\u0435 \u043d\u0443\u0436\u0435\u043d.
  await prisma.mailDraft.deleteMany({ where: { authorId: session.user.id, localPart: def.localPart } }).catch(() => {});

  return NextResponse.json({ ok: true, id: saved.id, messageId: result.messageId });
}
