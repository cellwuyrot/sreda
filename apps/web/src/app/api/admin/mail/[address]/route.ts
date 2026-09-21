import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import {
  findMailbox,
  isMailDirection,
  MAIL_PAGE_SIZE,
  MAIL_PAGE_SIZE_MAX,
} from "@/lib/projectMail";

/**
 * PROJECT-MAIL: листинг писем одного ящика и архивация письма.
 *
 * `address` в пути — это localPart (info, sales, …): стабильный идентификатор
 * без @ и точек, чтобы не воевать с кодированием URL.
 *
 * GET — страница истории ящика. Параметры:
 *   direction=incoming|outgoing — направление (иначе оба);
 *   archived=1                  — архив вместо активных;
 *   q=…                         — поиск по теме, адресам и предпросмотру;
 *   from=/to=/subject=          — фильтр папки (подстрока адреса/темы);
 *   limit=…&offset=…            — окно выборки.
 * Ответ: { messages, total, offset, limit, hasMore } — по total UI показывает
 * «показано X из Y» и решает, рисовать ли кнопку «Показать ещё».
 *
 * PATCH — архивировать/вернуть письмо: { id, archived: boolean }.
 */

/** Целое из строки запроса с потолком и полом — чтобы limit нельзя было раздуть. */
function intParam(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Подстрочный фильтр без учёта регистра — или ничего, если поле пустое. */
function contains(field: "fromAddr" | "toAddr" | "subject", raw: string | null) {
  const value = (raw || "").trim();
  if (!value) return null;
  return { [field]: { contains: value, mode: "insensitive" as const } };
}

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
    return NextResponse.json({ messages: [], total: 0, offset: 0, limit: MAIL_PAGE_SIZE, hasMore: false });
  }

  // searchParams берём из req.url, а не из req.nextUrl: так роут одинаково
  // работает и под Next, и под обычным Request в тестах.
  const params = new URL(req.url).searchParams;
  const directionParam = params.get("direction");
  const trashed = params.get("trashed") === "1";
  const archived = !trashed && params.get("archived") === "1";
  const query = (params.get("q") || "").trim();
  const limit = intParam(params.get("limit"), MAIL_PAGE_SIZE, 1, MAIL_PAGE_SIZE_MAX);
  const offset = intParam(params.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);

  // Поиск идёт по базе, а не по загруженной странице: иначе «поиск по ящику»
  // искал бы только среди строк текущей страницы листинга.
  const search = query
    ? {
        OR: [
          { subject: { contains: query, mode: "insensitive" as const } },
          { fromAddr: { contains: query, mode: "insensitive" as const } },
          { toAddr: { contains: query, mode: "insensitive" as const } },
          { preview: { contains: query, mode: "insensitive" as const } },
          { bodyText: { contains: query, mode: "insensitive" as const } },
        ],
      }
    : null;

  // Фильтр папки — тоже на стороне базы, чтобы папка отбирала письма по всей
  // истории ящика, а не по видимой странице.
  const folderFilters = [
    contains("fromAddr", params.get("from")),
    contains("toAddr", params.get("to")),
    contains("subject", params.get("subject")),
  ].filter((f): f is NonNullable<typeof f> => f !== null);

  const where = {
    mailboxId: mailbox.id,
    ...(trashed ? { trashedAt: { not: null } } : { trashedAt: null, archived }),
    ...(isMailDirection(directionParam) ? { direction: directionParam } : {}),
    ...(search ? { AND: [search, ...folderFilters] } : folderFilters.length ? { AND: folderFilters } : {}),
  };

  const [total, messages] = await Promise.all([
    prisma.mailMessage.count({ where }),
    prisma.mailMessage.findMany({
      where,
      // Второй ключ сортировки нужен, чтобы письма с одинаковым sentAt
      // (пачка из одного опроса) не перетасовывались между страницами.
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: limit,
      select: {
        id: true,
        direction: true,
        fromAddr: true,
        toAddr: true,
        subject: true,
        preview: true,
        archived: true,
        trashedAt: true,
        readAt: true,
        deliveryStatus: true,
        deliveryError: true,
        sentAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    messages,
    total,
    offset,
    limit,
    hasMore: offset + messages.length < total,
  });
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
  const action = typeof body?.action === "string" ? body.action : "";
  const archived = body?.archived;
  if (!id || (!action && typeof archived !== "boolean")) {
    return NextResponse.json({ error: "id and action (or archived:boolean) required" }, { status: 400 });
  }

  // Письмо обязано принадлежать именно этому ящику — иначе через чужой маршрут
  // можно было бы трогать письма другого ящика.
  const existing = await prisma.mailMessage.findFirst({ where: { id, mailboxId: mailbox.id } });
  if (!existing) return NextResponse.json({ error: "Message not found" }, { status: 404 });

  const data =
    action === "trash" ? { trashedAt: new Date() } :
    action === "restore" ? { trashedAt: null } :
    action === "read" ? { readAt: new Date() } :
    typeof archived === "boolean" ? { archived } :
    null;
  if (!data) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  await prisma.mailMessage.update({ where: { id }, data });

  await logAction({
    userId: session.user.id,
    username: session.user.username || session.user.name || "admin",
    action: "update",
    target: "MailMessage",
    targetId: id,
    details: `${action || (archived ? "archive" : "unarchive")} письма ящика ${mailbox.address}`,
  });

  return NextResponse.json({ ok: true, id, action, archived });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { address } = await ctx.params;
  const mailbox = await prisma.projectMailbox.findUnique({ where: { localPart: address.toLowerCase() } });
  if (!mailbox) return NextResponse.json({ error: "Unknown mailbox" }, { status: 404 });
  const id = new URL(req.url).searchParams.get("id") || "";
  const existing = await prisma.mailMessage.findFirst({
    where: { id, mailboxId: mailbox.id, trashedAt: { not: null } },
    select: { id: true, messageId: true },
  });
  if (!existing) return NextResponse.json({ error: "Message not found in trash" }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    if (existing.messageId) {
      await tx.mailDeletionTombstone.upsert({
        where: {
          mailboxId_messageKey: { mailboxId: mailbox.id, messageKey: existing.messageId },
        },
        update: { reason: "deleted" },
        create: { mailboxId: mailbox.id, messageKey: existing.messageId, reason: "deleted" },
      });
    }
    await tx.mailMessage.delete({ where: { id } });
  });
  return NextResponse.json({ ok: true, id });
}
