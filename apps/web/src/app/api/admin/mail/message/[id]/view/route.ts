import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await getServerSession(authOptions);
  if (!s?.user || (s.user as any).role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const m = await (prisma as any).mailMessage.findUnique({ where: { id }, include: { attachments: true } }).catch(() => null);
  if (!m) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  const message = { id: m.id, fromAddr: m.fromAddr, fromName: m.fromName, toAddr: m.toAddr, ccAddr: m.ccAddr, bccAddr: m.bccAddr, subject: m.subject, bodyHtml: m.bodyHtml, templateKey: m.templateKey, sentByName: m.sentByName, sentAt: m.createdAt, attachments: (m.attachments || []).map((a: any) => ({ id: a.id, name: a.name, mime: a.mime, size: a.size, inline: a.inline, url: `/api/admin/mail/attachment/${a.id}` })) };
  return NextResponse.json({ message });
}
