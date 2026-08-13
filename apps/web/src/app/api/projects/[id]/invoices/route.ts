import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { createNotification } from "@/lib/createNotification";
import { rateLimit } from "@/lib/rateLimit";
import {
  INVOICE_METHODS,
  loadProjectAccess,
  parseDate,
  recordProjectEvent,
  summarizeInvoices,
} from "@/lib/projectBusiness";

/**
 * BUSINESS-CABINET: счета и оплаты по проекту.
 *
 * GET  — владелец проекта (партнёр) или сотрудник.
 * POST — только сотрудник: счёт выставляет исполнитель, не заказчик.
 *
 * Сумма — целое число в минимальных единицах (копейках): Float здесь давал бы
 * ошибки округления в сводках по десяткам счетов.
 */

const MAX_AMOUNT = 100_000_000_00; // потолок от опечатки в сумме

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const access = await loadProjectAccess({ projectId: id, userId: session.user.id, role: session.user.role });
  if (!access) return NextResponse.json({ error: "Проект не найден" }, { status: 404 });

  const invoices = await prisma.projectInvoice.findMany({
    where: { projectId: id },
    orderBy: { number: "asc" },
  });

  return NextResponse.json({
    invoices,
    summary: summarizeInvoices(invoices),
    isStaff: access.isStaff,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const access = await loadProjectAccess({ projectId: id, userId: session.user.id, role: session.user.role });
  if (!access) return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  if (!access.isStaff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const limited = await rateLimit(req, `project-invoice:${session.user.id}`, { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as
    | { title?: unknown; amount?: unknown; currency?: unknown; method?: unknown; note?: unknown; dueDate?: unknown }
    | null;

  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 200) : "";
  if (!title) return NextResponse.json({ error: "Укажите назначение счёта" }, { status: 400 });

  const amount = typeof body?.amount === "number" ? Math.round(body.amount) : NaN;
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  const currency = typeof body?.currency === "string" && /^[A-Za-z]{3}$/.test(body.currency)
    ? body.currency.toUpperCase()
    : "RUB";

  const method = typeof body?.method === "string" && (INVOICE_METHODS as readonly string[]).includes(body.method)
    ? body.method
    : null;

  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 2000) || null : null;

  const dueDate = parseDate(body?.dueDate);
  if (dueDate === "invalid") return NextResponse.json({ error: "Некорректная дата оплаты" }, { status: 400 });

  const createdByName = session.user.name || session.user.username || "сотрудник";

  /* Номер счёта считается от последнего. Два сотрудника могут нажать одновременно,
     поэтому на паре (projectId, number) стоит уникальный индекс, а здесь —
     несколько попыток: терять счёт из-за гонки нельзя. */
  let invoice = null as Awaited<ReturnType<typeof prisma.projectInvoice.create>> | null;
  for (let attempt = 0; attempt < 4 && !invoice; attempt += 1) {
    const last = await prisma.projectInvoice.findFirst({
      where: { projectId: id },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    try {
      invoice = await prisma.projectInvoice.create({
        data: {
          projectId: id,
          number: (last?.number ?? 0) + 1,
          title,
          amount,
          currency,
          method,
          note,
          dueDate: dueDate ?? null,
          createdById: session.user.id,
          createdByName,
        },
      });
    } catch (error) {
      if (attempt === 3) {
        console.error("[ProjectInvoice] не удалось создать счёт", error);
        return NextResponse.json({ error: "Не удалось выставить счёт" }, { status: 500 });
      }
    }
  }
  if (!invoice) return NextResponse.json({ error: "Не удалось выставить счёт" }, { status: 500 });

  await recordProjectEvent({
    projectId: id,
    kind: "INVOICE_CREATED",
    title: `Счёт №${invoice.number}: ${title}`,
    details: `${(amount / 100).toFixed(2)} ${currency}`,
    actorId: session.user.id,
    actorName: createdByName,
  });

  if (access.project.ownerId !== session.user.id) {
    await createNotification({
      userId: access.project.ownerId,
      type: "project",
      title: "Новый счёт по проекту",
      body: `«${access.project.name}»: ${title} — ${(amount / 100).toFixed(2)} ${currency}`,
      link: "/partner",
    }).catch(() => {});
  }

  return NextResponse.json({ invoice });
}
