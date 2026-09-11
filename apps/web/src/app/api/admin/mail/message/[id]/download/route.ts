import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { buildEml, emlFileName } from "@/lib/projectMail";

/**
 * PROJECT-MAIL: скачать письмо файлом .eml. Формат .eml открывается любым
 * почтовым клиентом и сохраняет заголовки — так письмо можно приобщить к
 * делу или переслать. Сборка .eml — чистая функция buildEml (lib/projectMail).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const msg = await prisma.mailMessage.findUnique({ where: { id } });
  if (!msg) return NextResponse.json({ error: "Message not found" }, { status: 404 });

  const eml = buildEml({
    fromAddr: msg.fromAddr,
    toAddr: msg.toAddr,
    subject: msg.subject,
    sentAt: msg.sentAt,
    bodyText: msg.bodyText,
    bodyHtml: msg.bodyHtml,
    messageId: msg.messageId,
  });

  return new NextResponse(eml, {
    status: 200,
    headers: {
      "Content-Type": "message/rfc822; charset=utf-8",
      "Content-Disposition": `attachment; filename="${emlFileName(msg.id)}"`,
      "Cache-Control": "no-store",
    },
  });
}
