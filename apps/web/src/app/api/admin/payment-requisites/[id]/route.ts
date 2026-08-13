import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logAction } from "@/lib/audit";
import {
  REQUISITE_SELECT,
  clearDefaults,
  isRequisiteScope,
  parseRequisitePatch,
  requisiteText,
} from "@/lib/paymentRequisites";

/**
 * PAY-TEMPLATE: правка (PATCH) и удаление (DELETE) шаблона реквизитов.
 *
 * Чужой ЛИЧНЫЙ шаблон недоступен даже другому администратору: там банковские данные
 * конкретного человека. Общий шаблон правит любой ADMIN — это справочник проекта.
 *
 * Удаление шаблона НЕ трогает выставленные счета: в счёте лежит снимок текста
 * реквизитов, а ссылка обнуляется (onDelete: SetNull). Иначе удаление шаблона
 * задним числом меняло бы условия оплаты у клиента.
 */

async function loadTarget(id: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (session.user.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const row = await prisma.paymentRequisite.findUnique({ where: { id }, select: REQUISITE_SELECT });
  if (!row) return { error: NextResponse.json({ error: "Шаблон не найден" }, { status: 404 }) };
  if (row.ownerId !== null && row.ownerId !== session.user.id) {
    return {
      error: NextResponse.json(
        { error: "Это личный шаблон другого администратора" },
        { status: 403 },
      ),
    };
  }
  return { session, row };
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const guard = await loadTarget(id);
  if (guard.error) return guard.error;
  const session = guard.session!;
  const row = guard.row!;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Пустой запрос" }, { status: 400 });

  const parsed = parseRequisitePatch(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const patch: Record<string, unknown> = { ...parsed.patch };

  /* Перевод личного шаблона в общий и обратно. Смена владельца — отдельное решение,
     поэтому признак «по умолчанию» пересчитывается в новой группе. */
  let ownerId = row.ownerId;
  if (body.shared !== undefined) {
    ownerId = body.shared === true ? null : session.user.id;
    patch.ownerId = ownerId;
  }

  const scope = isRequisiteScope(patch.scope) ? patch.scope : row.scope;
  if (patch.isDefault === true) await clearDefaults(scope, ownerId, row.id);

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Не передано ни одного изменения" }, { status: 400 });
  }

  const updated = await prisma.paymentRequisite.update({
    where: { id: row.id },
    data: patch,
    select: REQUISITE_SELECT,
  });

  await logAction({
    userId: session.user.id,
    username: session.user.name ?? "",
    action: "payments.requisite.update",
    target: updated.name,
    targetId: updated.id,
    details: Object.keys(patch)
      .filter((k) => k !== "ownerId")
      .join(", ")
      .slice(0, 300),
  });

  return NextResponse.json({
    requisite: {
      id: updated.id,
      name: updated.name,
      shared: updated.ownerId === null,
      isDefault: updated.isDefault,
      preview: requisiteText(updated),
    },
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const guard = await loadTarget(id);
  if (guard.error) return guard.error;
  const session = guard.session!;
  const row = guard.row!;

  await prisma.paymentRequisite.delete({ where: { id: row.id } });

  await logAction({
    userId: session.user.id,
    username: session.user.name ?? "",
    action: "payments.requisite.delete",
    target: row.name,
    targetId: row.id,
    details: row.ownerId ? "личный шаблон" : "общий шаблон",
  });

  return NextResponse.json({ success: true });
}
