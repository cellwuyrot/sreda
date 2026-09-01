import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * WS-TABLE: API для хранения данных таблиц отдельно от WorkspaceState.
 *
 * Проблема: WorkspaceState хранит ВСЁ в одном JSON-поле (лимит 2 МБ).
 * Одна таблица с 10k строк x 20 колонок может занять >1 МБ сама по себе.
 * Решение: cells/colWidths/rowHeights хранятся в WorkspaceTable,
 * в карточке остаётся только tableDataId — ссылка на запись.
 *
 * GET  /api/workspace/tables?cardId=xxx  — загрузить данные таблицы
 * PUT  /api/workspace/tables             — сохранить данные таблицы (upsert)
 */

const MAX_TABLE_BYTES = 20_000_000; // 20 МБ на одну таблицу

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const cardId = searchParams.get("cardId");
  if (!cardId) return NextResponse.json({ error: "cardId required" }, { status: 400 });

  const row = await prisma.workspaceTable.findUnique({
    where: { ownerKey_cardId: { ownerKey: session.user.id, cardId } },
  });

  return NextResponse.json({
    cells: row ? JSON.parse(row.cells) : null,
    colWidths: row?.colWidths ? JSON.parse(row.colWidths) : null,
    rowHeights: row?.rowHeights ? JSON.parse(row.rowHeights) : null,
  });
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const { cardId, cells, colWidths, rowHeights } = body ?? {};

  if (!cardId || !Array.isArray(cells)) {
    return NextResponse.json({ error: "cardId and cells[] required" }, { status: 400 });
  }

  const cellsJson = JSON.stringify(cells);
  if (cellsJson.length > MAX_TABLE_BYTES) {
    return NextResponse.json({ error: "Table data too large" }, { status: 413 });
  }

  await prisma.workspaceTable.upsert({
    where: { ownerKey_cardId: { ownerKey: session.user.id, cardId } },
    update: {
      cells: cellsJson,
      colWidths: colWidths ? JSON.stringify(colWidths) : null,
      rowHeights: rowHeights ? JSON.stringify(rowHeights) : null,
    },
    create: {
      ownerKey: session.user.id,
      cardId,
      cells: cellsJson,
      colWidths: colWidths ? JSON.stringify(colWidths) : null,
      rowHeights: rowHeights ? JSON.stringify(rowHeights) : null,
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const cardId = searchParams.get("cardId");
  if (!cardId) return NextResponse.json({ error: "cardId required" }, { status: 400 });

  await prisma.workspaceTable.deleteMany({
    where: { ownerKey: session.user.id, cardId },
  });

  return NextResponse.json({ ok: true });
}
