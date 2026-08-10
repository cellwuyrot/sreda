import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { emitToUser } from "@/lib/socketEmit";
import { businessAudience, isStaffRole } from "@/lib/businessChat";

/**
 * BUSINESS-LOCK: POST /api/dm/[id]/lock — закрыть или открыть клиенту отправку
 * сообщений в деловом разговоре.
 *
 * ── Зачем это вообще ────────────────────────────────────────────────────────
 *
 * В деловом разговоре нет чёрного списка и не может быть: собеседник у клиента —
 * администрация, а не человек, и «занести в ЧС» означало бы, что сотрудник
 * отрезает клиента от канала, который заводился ради работы. Закрытие заявки тоже
 * ничего не запрещало: статус — это состояние работы, а не право писать. В итоге
 * не было никакого способа остановить того, кто продолжает писать после того, как
 * разговор окончен.
 *
 * ── Почему запрет односторонний ─────────────────────────────────────────────
 *
 * Закрывается отправка ТОЛЬКО клиенту. Администрация писать может и после
 * закрытия — иначе последнее слово всегда оставалось бы за клиентом, и закрытие
 * теряло бы смысл: нельзя было бы даже объяснить, почему разговор окончен.
 *
 * ── Кто может ───────────────────────────────────────────────────────────────
 *
 * Только администратор и редактор, и только в деловом разговоре. В личной
 * переписке такого запрета нет намеренно: там для этого есть чёрный список, и он
 * взаимный, а односторонний запрет между двумя людьми был бы новым видом власти
 * одного над другим.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  /* Право даёт роль, а не место в паре: очередь заявок общая, и закрывать
     отправку может не только тот, кто взял заявку. */
  if (!isStaffRole(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { locked?: unknown } | null;
  if (typeof body?.locked !== "boolean") {
    return NextResponse.json({ error: "Ожидается locked: true или false" }, { status: 400 });
  }

  const conversation = await prisma.directConversation.findUnique({ where: { id } });
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (conversation.kind !== "BUSINESS") {
    return NextResponse.json(
      { error: "Запрет отправки есть только в деловом разговоре: в личной переписке для этого чёрный список" },
      { status: 400 },
    );
  }

  const updated = await prisma.directConversation.update({
    where: { id },
    data: { locked: body.locked, lockedAt: body.locked ? new Date() : null },
    select: { id: true, locked: true, lockedAt: true },
  });

  /* Знать об этом должны обе стороны и сразу: клиенту — чтобы ввод закрылся под
     рукой, а не после отказа на отправку; остальной администрации — чтобы двое
     сотрудников не открывали и закрывали отправку по кругу, не видя друг друга. */
  const audience = await businessAudience(conversation);
  for (const recipientId of new Set([...audience, session.user.id])) {
    emitToUser(recipientId, "dm-lock-changed", {
      conversationId: id,
      locked: updated.locked,
      lockedAt: updated.lockedAt?.toISOString() ?? null,
    });
  }

  return NextResponse.json({ conversationId: id, locked: updated.locked });
}
