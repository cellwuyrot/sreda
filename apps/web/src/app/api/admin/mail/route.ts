import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { PROJECT_MAILBOXES, mailboxAddress } from "@/lib/projectMail";

/**
 * PROJECT-MAIL: сводка почтовых ящиков домена для экрана «Email и обработка
 * данных». Отдаёт все ящики с числом писем (входящие/исходящие, без
 * архива) для левой колонки.
 *
 * Список ящиков берётся из базы, но если посев ещё не прошёл (первый
 * деплой), подмешиваем канонический список из кода, чтобы экран не был пуст.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const boxes = await prisma.projectMailbox.findMany({ orderBy: { order: "asc" } });

  // Счётчики одним запросом — группировка по ящику и направлению (без архива).
  const grouped = await prisma.mailMessage.groupBy({
    by: ["mailboxId", "direction"],
    where: { archived: false },
    _count: { _all: true },
  });
  const counts = new Map<string, { incoming: number; outgoing: number }>();
  for (const g of grouped) {
    const cur = counts.get(g.mailboxId) ?? { incoming: 0, outgoing: 0 };
    if (g.direction === "incoming") cur.incoming = g._count._all;
    else if (g.direction === "outgoing") cur.outgoing = g._count._all;
    counts.set(g.mailboxId, cur);
  }

  const fromDb = boxes.map((b) => ({
    localPart: b.localPart,
    address: b.address,
    label: b.label,
    purpose: b.purpose,
    active: b.active,
    incoming: counts.get(b.id)?.incoming ?? 0,
    outgoing: counts.get(b.id)?.outgoing ?? 0,
  }));

  // Если ящика из канонического списка ещё нет в базе — покажем его как пустой.
  const known = new Set(fromDb.map((b) => b.localPart));
  const missing = PROJECT_MAILBOXES.filter((m) => !known.has(m.localPart)).map((m) => ({
    localPart: m.localPart,
    address: mailboxAddress(m.localPart),
    label: m.label,
    purpose: m.purpose,
    active: true,
    incoming: 0,
    outgoing: 0,
  }));

  return NextResponse.json({ mailboxes: [...fromDb, ...missing] });
}
