import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/** PROJECT-MAIL: \u043f\u0440\u043e\u0441\u043c\u043e\u0442\u0440 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043d\u043e\u0433\u043e \u043f\u0438\u0441\u044c\u043c\u0430 \u0441 \u0432\u043b\u043e\u0436\u0435\u043d\u0438\u044f\u043c\u0438. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const msg = await prisma.mailMessage.findUnique({ where: { id }, include: { attachments: true } }).catch(() => null);
  if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    message: {
      id: msg.id, fromAddr: msg.fromAddr, fromName: msg.fromName, toAddr: msg.toAddr,
      ccAddr: msg.ccAddr, bccAddr: msg.bccAddr, subject: msg.subject, bodyHtml: msg.bodyHtml || "",
      templateKey: msg.templateKey, sentByName: msg.sentByName, sentAt: msg.sentAt,
      attachments: msg.attachments.map((a) => ({ id: a.id, name: a.name, mime: a.mime, size: a.size, inline: a.inline, url: `/api/admin/mail/attachment/${a.id}` })),
    },
  });
}
