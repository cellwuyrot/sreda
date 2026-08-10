import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { emitToUser } from "@/lib/socketEmit";
import { personalOwnerKey } from "@/lib/workspaceHistory";
import { captureSnapshot, listSnapshots, readSnapshot } from "@/lib/workspaceSnapshots";

/**
 * WS-HISTORY: история личной рабочей среды.
 *
 * GET  — список снимков: когда и какого размера. Сам холст в списке не
 *        отдаётся: список открывается часто, а снимок — это всё содержимое.
 * POST — вернуть состояние из снимка.
 *
 * Перед возвратом делается снимок ТЕКУЩЕГО состояния. Иначе «вернуть как было»
 * само становится способом потерять работу: человек отыгрывает назад, понимает,
 * что ошибся, — и вернуться уже некуда.
 */

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const snapshots = await listSnapshots(personalOwnerKey(session.user.id));
  return NextResponse.json({ snapshots });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Не указан снимок" }, { status: 400 });

  const ownerKey = personalOwnerKey(session.user.id);
  const data = await readSnapshot(ownerKey, id);
  if (!data) return NextResponse.json({ error: "Снимок не найден" }, { status: 404 });

  /* Снимок текущего состояния ДО возврата — чтобы шаг назад сам был обратим.
     Интервал здесь намеренно обходится: это не рутинное сохранение, а
     единственный момент, когда прежнее состояние вот-вот исчезнет. */
  const current = await prisma.workspaceState.findUnique({ where: { userId: session.user.id } });
  if (current?.data) await captureSnapshot(ownerKey, current.data, session.user.id);

  const state = await prisma.workspaceState.upsert({
    where: { userId: session.user.id },
    update: { data },
    create: { userId: session.user.id, data },
  });

  /* Событие без clientId: возврат должны увидеть ВСЕ устройства, включая то, с
     которого его сделали, — иначе на экране останется прежний холст. */
  emitToUser(session.user.id, "workspace-updated", { clientId: null, updatedAt: state.updatedAt });

  return NextResponse.json({ ok: true, updatedAt: state.updatedAt });
}
