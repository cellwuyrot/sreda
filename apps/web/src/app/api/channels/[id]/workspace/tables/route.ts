import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getChannelPermissions } from "@/lib/connectPermissions";

/**
 * WS-TABLE: API таблиц группового Workspace (канал типа CANVAS).
 * Аналог /api/workspace/tables, но ownerKey = "channel:<id>".
 */

const MAX_TABLE_BYTES = 20_000_000;

function channelOwnerKey(channelId: string) {
  return `channel:${channelId}`;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: channelId } = await params;
  const perms = await getChannelPermissions(session.user.id, channelId);
  if (!perms?.canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const cardId = searchParams.get("cardId");
  if (!cardId) return NextResponse.json({ error: "cardId required" }, { status: 400 });

  const row = await prisma.workspaceTable.findUnique({
    where: { ownerKey_cardId: { ownerKey: channelOwnerKey(channelId), cardId } },
  });

  return NextResponse.json({
    cells: row ? JSON.parse(row.cells) : null,
    colWidths: row?.colWidths ? JSON.parse(row.colWidths) : null,
    rowHeights: row?.rowHeights ? JSON.parse(row.rowHeights) : null,
  });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: channelId } = await params;
  const perms = await getChannelPermissions(session.user.id, channelId);
  if (!perms?.canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!perms?.canPost) return NextResponse.json({ error: "Read-only" }, { status: 403 });

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
    where: { ownerKey_cardId: { ownerKey: channelOwnerKey(channelId), cardId } },
    update: {
      cells: cellsJson,
      colWidths: colWidths ? JSON.stringify(colWidths) : null,
      rowHeights: rowHeights ? JSON.stringify(rowHeights) : null,
    },
    create: {
      ownerKey: channelOwnerKey(channelId),
      cardId,
      cells: cellsJson,
      colWidths: colWidths ? JSON.stringify(colWidths) : null,
      rowHeights: rowHeights ? JSON.stringify(rowHeights) : null,
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: channelId } = await params;
  const perms = await getChannelPermissions(session.user.id, channelId);
  if (!perms?.canPost) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const cardId = searchParams.get("cardId");
  if (!cardId) return NextResponse.json({ error: "cardId required" }, { status: 400 });

  await prisma.workspaceTable.deleteMany({
    where: { ownerKey: channelOwnerKey(channelId), cardId },
  });

  return NextResponse.json({ ok: true });
}
