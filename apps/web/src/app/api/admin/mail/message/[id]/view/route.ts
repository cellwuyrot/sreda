import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const message = await prisma.$transaction(async (tx) => {
    const found = await tx.mailMessage.findUnique({
      where: { id },
      include: { attachments: true },
    });
    if (found?.direction === "incoming" && !found.readAt) {
      await tx.mailMessage.update({ where: { id }, data: { readAt: new Date() } });
      return { ...found, readAt: new Date() };
    }
    return found;
  }).catch(() => null);
  if (!message) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  return NextResponse.json({
    message: {
      id: message.id,
      direction: message.direction,
      fromAddr: message.fromAddr,
      fromName: message.fromName,
      toAddr: message.toAddr,
      ccAddr: message.ccAddr,
      bccAddr: message.bccAddr,
      subject: message.subject,
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml,
      messageId: message.messageId,
      inReplyToMid: message.inReplyToMid,
      archived: message.archived,
      trashedAt: message.trashedAt,
      readAt: message.readAt,
      deliveryStatus: message.deliveryStatus,
      deliveryError: message.deliveryError,
      templateKey: message.templateKey,
      sentByName: message.sentByName,
      // Именно sentAt: createdAt — это время записи в базу, и у писем,
      // подтянутых по IMAP задним числом, оно расходилось с датой в списке.
      sentAt: message.sentAt,
      attachments: message.attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        mime: attachment.mime,
        size: attachment.size,
        inline: attachment.inline,
        url: `/api/admin/mail/attachment/${attachment.id}`,
      })),
    },
  });
}
