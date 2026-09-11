import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import { findMailbox, isMailDirection, MAIL_LISTING_LIMIT } from "@/lib/projectMail";

/**
 * PROJECT-MAIL: листинг писем одного ящика и архивация письма.
 *
 * `address` в пути — это localPart (info, sales, …): стабильный идентификатор
 * без @ и точек, чтобы не воевать с кодированием URL.
 *
 * GET  — до MAIL_LISTING_LIMIT (10) последних писем. Необязательный
 *        ?direction=incoming|outgoing фильтрует направление; ?archived=1 показывает
 *        архив вместо активных.
 * PATCH — архивировать/вернуть письмо: { id, archived: boolean }.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { address } = await ctx.params;
  if (!findMailbox(address)) {
    return NextResponse.json({ error: "Unknown mailbox" }, { status: 404 });
  }

  const mailbox = await prisma.projectMailbox.findUnique({ where: { localPart: address.toLowerCase() } });
  if (!mailbox) {
    // Ящик из канонического списка ещё не посеян — писем по нему пока нет.
    return NextResponse.json({ messages: [] });
  }

  const directionParam = req.nextUrl.searchParams.get("direction");
  const archived = req.nextUrl.searchParams.get("archived") === "1";

  const messages = await prisma.mailMessage.findMany({
    where: {
      mailboxId: mailbox.id,
      archived,
      ...(isMailDirection(directionParam) ? { direction: directionParam } : {}),
    },
    orderBy: { sentAt: "desc" },
    take: MAIL_LISTING_LIMIT,
    select: {
      id: true,
      direction: true,
      fromAddr: true,
      toAddr: true,
      subject: true,
      preview: true,
      archived: true,
      sentAt: true,
    },
  });

  return NextResponse.json({ messages });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { address } = await ctx.params;
  const mailbox = await prisma.projectMailbox.findUnique({ where: { localPart: address.toLowerCase() } });
  if (!mailbox) return NextResponse.json({ error: "Unknown mailbox" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const id: string = typeof body?.id === "string" ? body.id : "";
  const archived = body?.archived;
  if (!id || typeof archived !== "boolean") {
    return NextResponse.json({ error: "id and archived:boolean required" }, { status: 400 });
  }

  // Письмо обязано принадлежать именно этому ящику — иначе через чужой маршрут
  // можно было бы трогать письма другого ящика.
  const existing = await prisma.mailMessage.findFirst({ where: { id, mailboxId: mailbox.id } });
  if (!existing) return NextResponse.json({ error: "Message not found" }, { status: 404 });

  await prisma.mailMessage.update({ where: { id }, data: { archived } });

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "admin",
    action: "update",
    target: "MailMessage",
    targetId: id,
    details: `${archived ? "Архивировано" : "Возвращено из архива"} письмо ящика ${mailbox.address}`,
  });

  return NextResponse.json({ ok: true, id, archived });
}
