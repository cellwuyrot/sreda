import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { createNotification } from "@/lib/createNotification";
import { isInvoiceStatus, loadProjectAccess, recordProjectEvent } from "@/lib/projectBusiness";

/**
 * BUSINESS-CABINET: состояние счёта.
 *
 * Сотрудник меняет статус (UNPAID/PAID/CANCELLED) и реквизиты платежа.
 * Клиент (владелец проекта) может только сообщить об оплате (declare) — сам
 * статус при этом НЕ меняется: «оплачено» подтверждает только исполнитель.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; invoiceId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, invoiceId } = await params;

  const access = await loadProjectAccess({ projectId: id, userId: session.user.id, role: session.user.role });
  if (!access) return NextResponse.json({ error: "Проект не найден" }, { status: 404 });

  const invoice = await prisma.projectInvoice.findFirst({ where: { id: invoiceId, projectId: id } });
  if (!invoice) return NextResponse.json({ error: "Счёт не найден" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as
    | { status?: unknown; reference?: unknown; note?: unknown; declare?: unknown }
    | null;

  const actorName = session.user.name || session.user.username || "пользователь";

  // Клиент: только сообщение об оплате.
  if (!access.isStaff) {
    if (body?.declare !== true) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";
    await recordProjectEvent({
      projectId: id,
      kind: "INVOICE_DECLARED",
      title: `Клиент сообщил об оплате счёта №${invoice.number}`,
      details: note || null,
      actorId: session.user.id,
      actorName,
      actorSide: "CLIENT",
    });
    return NextResponse.json({ ok: true });
  }

  const data: Record<string, unknown> = {};
  if (body?.status !== undefined) {
    if (!isInvoiceStatus(body.status)) {
      return NextResponse.json({ error: "Неизвестный статус счёта" }, { status: 400 });
    }
    data.status = body.status;
    data.paidAt = body.status === "PAID" ? new Date() : null;
  }
  if (body?.reference !== undefined) {
    data.reference = typeof body.reference === "string" ? body.reference.trim().slice(0, 300) || null : null;
  }
  if (body?.note !== undefined) {
    data.note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) || null : null;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Не передано ни одного изменения" }, { status: 400 });
  }

  const updated = await prisma.projectInvoice.update({ where: { id: invoiceId }, data });

  if (data.status && data.status !== invoice.status) {
    const label =
      updated.status === "PAID" ? "оплачен" : updated.status === "CANCELLED" ? "отменён" : "ожидает оплаты";
    await recordProjectEvent({
      projectId: id,
      kind: "INVOICE_STATUS",
      title: `Счёт №${invoice.number} — ${label}`,
      actorId: session.user.id,
      actorName,
    });
    if (access.project.ownerId !== session.user.id) {
      await createNotification({
        userId: access.project.ownerId,
        type: "project",
        title: `Счёт №${invoice.number}: ${label}`,
        body: `«${access.project.name}»: ${invoice.title}`,
        link: "/partner",
      }).catch(() => {});
    }
  }

  return NextResponse.json({ invoice: updated });
}
