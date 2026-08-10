import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

// Пользовательская раскладка списка сообществ: порядок + папки (как в Discord).
// data — JSON-строка вида:
// { "v": 1, "items": [
//   { "type": "group", "id": "..." },
//   { "type": "folder", "id": "...", "name": "Папка", "collapsed": false, "groupIds": ["...", "..."] }
// ] }
// Требует модель GroupLayout в prisma/schema.prisma (см. prisma-additions.prisma).

const MAX_BYTES = 100_000;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const layout = await prisma.groupLayout.findUnique({
    where: { userId: session.user.id },
  });

  return NextResponse.json({
    data: layout?.data ?? null,
    updatedAt: layout?.updatedAt ?? null,
  });
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const data = body?.data;

  if (typeof data !== "string" || data.length === 0) {
    return NextResponse.json({ error: "data (string) required" }, { status: 400 });
  }
  if (data.length > MAX_BYTES) {
    return NextResponse.json({ error: "Layout too large" }, { status: 413 });
  }

  let parsed: { items?: unknown } | null = null;
  try {
    parsed = JSON.parse(data) as { items?: unknown };
  } catch {
    return NextResponse.json({ error: "data must be valid JSON" }, { status: 400 });
  }
  if (!parsed || !Array.isArray(parsed.items)) {
    return NextResponse.json({ error: "items array required" }, { status: 400 });
  }

  const layout = await prisma.groupLayout.upsert({
    where: { userId: session.user.id },
    update: { data },
    create: { userId: session.user.id, data },
  });

  return NextResponse.json({ ok: true, updatedAt: layout.updatedAt });
}
