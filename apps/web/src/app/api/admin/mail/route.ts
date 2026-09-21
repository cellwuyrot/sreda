import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { PROJECT_MAILBOXES, mailboxAddress } from "@/lib/projectMail";

/**
 * PROJECT-MAIL: сводка почтовых ящиков домена для экрана «Email и обработка
 * данных» — левая колонка со списком ящиков.
 *
 * Список ящиков берётся из базы, но если посев ещё не прошёл (первый
 * деплой), подмешиваем канонический список из кода, чтобы экран не был пуст.
 *
 * Счётчиков писем здесь намеренно нет. Раньше роут отдавал число неархивных
 * писем на ящик, и в списке висели значки «↓ 7 ↑ 3». Они выглядели как
 * непрочитанные, но означали другое: число падало от архивации и росло от
 * дублей повторного опроса — то есть менялось от нажатий на ящик. Сколько
 * писем в текущей выборке, честно считает сам листинг
 * (`/api/admin/mail/[address]` → `total`).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const boxes = await prisma.projectMailbox.findMany({ orderBy: { order: "asc" } });

  const fromDb = boxes.map((b) => ({
    localPart: b.localPart,
    address: b.address,
    label: b.label,
    purpose: b.purpose,
    active: b.active,
    lastSyncAt: b.lastSyncAt,
    lastSyncError: b.lastSyncError,
  }));

  // Если ящика из канонического списка ещё нет в базе — покажем его как пустой.
  const known = new Set(fromDb.map((b) => b.localPart));
  const missing = PROJECT_MAILBOXES.filter((m) => !known.has(m.localPart)).map((m) => ({
    localPart: m.localPart,
    address: mailboxAddress(m.localPart),
    label: m.label,
    purpose: m.purpose,
    active: true,
    lastSyncAt: null,
    lastSyncError: null,
  }));

  return NextResponse.json({ mailboxes: [...fromDb, ...missing] });
}
