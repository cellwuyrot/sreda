import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { currentTargetNode, migrateBatch, restoreToMain } from "@/lib/uploadOffload";

/**
 * STORAGE-PRIORITY: где лежат файлы и перекладывание их между машинами.
 *
 * Только ADMIN: это распоряжение железом, а не содержимым.
 *
 * Перенос идёт порциями по нажатию, а не сам по себе в фоне. Причина простая:
 * фоновая перекладка сотен гигабайт — это работа, которую никто не видит и
 * никто не может остановить, когда она мешает. Здесь администратор видит
 * остаток и решает, когда двигать дальше.
 */

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return null;
  return session.user;
}

const MAX_BATCH = 200;

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [total, pending, grouped, target] = await Promise.all([
    prisma.uploadedFile.count(),
    prisma.uploadedFile.count({ where: { nodeId: null } }),
    prisma.uploadedFile.groupBy({ by: ["nodeId"], _count: { _all: true } }),
    currentTargetNode(),
  ]);

  const names = new Map<string, string>();
  const ids = (Array.isArray(grouped) ? grouped : [])
    .map((row) => row.nodeId)
    .filter((value): value is string => !!value);
  if (ids.length) {
    const nodes = await prisma.serverNode.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    for (const node of Array.isArray(nodes) ? nodes : []) names.set(node.id, node.name);
  }

  return NextResponse.json({
    total,
    /* «На главном сервере» — это не остаток работы, а обычное состояние, пока
       узла нет. Разделяем явно, чтобы цифра не выглядела очередью. */
    onMain: pending,
    byNode: (Array.isArray(grouped) ? grouped : [])
      .filter((row) => !!row.nodeId)
      .map((row) => ({
        nodeId: row.nodeId as string,
        name: names.get(row.nodeId as string) ?? "узел удалён",
        count: row._count._all,
      })),
    target: target ? { id: target.id, name: target.name } : null,
  });
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as
    | { action?: unknown; limit?: unknown; nodeId?: unknown }
    | null;

  /* Бессмысленное значение — это «не указано», а не «одна штука»: отрицательный
     размер порции превращал бы кнопку в переносящую по файлу за нажатие. */
  const raw = Number(body?.limit);
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(MAX_BATCH, Math.floor(raw)) : 25;

  if (body?.action === "migrate") {
    const result = await migrateBatch(limit);
    if (!result.nodeName) {
      return NextResponse.json(
        { error: "Нет настроенного узла хранения — файлы остаются на главном сервере" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, ...result });
  }

  if (body?.action === "restore") {
    const nodeId = typeof body.nodeId === "string" ? body.nodeId : "";
    if (!nodeId) return NextResponse.json({ error: "Не указан узел" }, { status: 400 });

    const files = await prisma.uploadedFile.findMany({
      where: { nodeId },
      select: { path: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    let moved = 0;
    let failed = 0;
    for (const file of Array.isArray(files) ? files : []) {
      if (await restoreToMain(file.path)) moved += 1;
      else failed += 1;
    }
    const remaining = await prisma.uploadedFile.count({ where: { nodeId } }).catch(() => 0);
    return NextResponse.json({ ok: true, moved, failed, remaining });
  }

  return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
}
