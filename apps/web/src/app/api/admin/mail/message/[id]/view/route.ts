import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const message = await prisma.mailMessage.findUnique({
    where: { id },
    include: { attachments: true },
  }).catch(() => null);
  if (!message) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  return NextResponse.json({
    message: {
      id: message.id,
      fromAddr: message.fromAddr,
      fromName: message.fromName,
      toAddr: message.toAddr,
      ccAddr: message.ccAddr,
      bccAddr: message.bccAddr,
      subject: message.subject,
      bodyHtml: message.bodyHtml,
      templateKey: message.templateKey,
      sentByName: message.sentByName,
      sentAt: message.createdAt,
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
