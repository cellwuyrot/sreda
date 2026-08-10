import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { isValidRemindAt, reminderTitle, sanitizeReminderLink } from "@/lib/reminders";

/**
 * REMIND: напоминания на карточках рабочей среды.
 *
 *  GET    — что ещё не сработало (холст сверяет колокольчики при открытии).
 *  POST   — поставить или передвинуть напоминание на карточке.
 *  DELETE — снять.
 *
 * ── Почему напоминание живёт здесь, а не только в карточке ──────────────────
 *
 * Карточка — кусок JSON внутри состояния среды. Пока холст закрыт, её никто не
 * читает, и «сработать» она не может. Отдельная строка нужна ровно для того,
 * чтобы сервер мог найти наступившие сроки, ничего не разбирая (см. обход в
 * server.ts).
 *
 * ── Одна карточка — одно напоминание ────────────────────────────────────────
 *
 * Повторная постановка заменяет прежнюю. Иначе передвинутый срок оставлял бы
 * позади себя старое напоминание, и человек получал бы оба — то, от чего он
 * как раз и отказался, передвигая.
 *
 * Чужую карточку не тронуть: строки ищутся по паре «человек + карточка», и
 * человек берётся из сессии, а не из тела запроса.
 */

/** Идентификатор карточки на холсте: короткая строка без пробелов. */
function isCardId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64 && !/\s/.test(value);
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.cardReminder.findMany({
    where: { userId: session.user.id, firedAt: null },
    select: { cardId: true, remindAt: true },
    take: 500,
  });

  return NextResponse.json({
    reminders: rows.map((r) => ({ cardId: r.cardId, remindAt: r.remindAt.getTime() })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  /* Предел щедрый: расставить напоминания на десятке карточек подряд — обычное
     дело, а вот сотня за минуту означает ошибку в клиенте. */
  const limited = await rateLimit(req, `card-reminder:${session.user.id}`, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as {
    cardId?: unknown;
    title?: unknown;
    link?: unknown;
    remindAt?: unknown;
  } | null;

  if (!isCardId(body?.cardId)) {
    return NextResponse.json({ error: "Не указана карточка" }, { status: 400 });
  }
  if (!isValidRemindAt(body?.remindAt)) {
    /* Прошлое сработало бы в первый же обход, а «через сто лет» — почти всегда
       промах в поле ввода года. */
    return NextResponse.json({ error: "Некорректное время напоминания" }, { status: 400 });
  }

  const remindAt = new Date(body.remindAt as number);
  const title = reminderTitle(body?.title);
  const link = sanitizeReminderLink(body?.link);

  await prisma.cardReminder.upsert({
    where: { userId_cardId: { userId: session.user.id, cardId: body.cardId } },
    create: { userId: session.user.id, cardId: body.cardId, title, link, remindAt },
    /* firedAt сбрасываем: передвинули срок — напоминание снова ждёт своего часа. */
    update: { title, link, remindAt, firedAt: null },
  });

  return NextResponse.json({ ok: true, remindAt: remindAt.getTime() });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { cardId?: unknown } | null;
  if (!isCardId(body?.cardId)) {
    return NextResponse.json({ error: "Не указана карточка" }, { status: 400 });
  }

  /* Снимаем только своё: чужое напоминание не удалить, даже зная идентификатор
     карточки. */
  await prisma.cardReminder.deleteMany({ where: { userId: session.user.id, cardId: body.cardId } });
  return NextResponse.json({ ok: true });
}
