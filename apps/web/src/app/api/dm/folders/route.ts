import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/* DM-FOLDER-SYNC: серверное хранение папок личных сообщений.
   GET  — получить папки для текущего пользователя по типу раздела.
   PUT  — сохранить папки (перезаписывает полностью). */

const MAX_FOLDERS   = 12;
const FOLDER_NAME_MAX = 24;

type RawFolder = { id?: unknown; name?: unknown; convIds?: unknown };

function sanitizeFolders(raw: unknown): Array<{ id: string; name: string; convIds: string[] }> {
  if (!Array.isArray(raw)) return [];
  return (raw as RawFolder[])
    .filter((f) => f && typeof f.id === "string" && typeof f.name === "string")
    .slice(0, MAX_FOLDERS)
    .map((f) => ({
      id: (f.id as string).slice(0, 64),
      name: (f.name as string).trim().slice(0, FOLDER_NAME_MAX),
      convIds: Array.isArray(f.convIds)
        ? (f.convIds as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
    }))
    .filter((f) => f.id && f.name);
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const kind = req.nextUrl.searchParams.get("kind") ?? "dm";

  const record = await prisma.dmFolderLayout.findUnique({
    where: { userId_kind: { userId: session.user.id, kind } },
  });

  if (!record) return NextResponse.json({ folders: [] });

  try {
    const parsed: unknown = JSON.parse(record.data);
    return NextResponse.json({ folders: sanitizeFolders(parsed) });
  } catch {
    return NextResponse.json({ folders: [] });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as { kind?: unknown; folders?: unknown } | null;
  if (!body || typeof body.kind !== "string") {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const kind    = body.kind.slice(0, 64);
  const folders = sanitizeFolders(body.folders);

  await prisma.dmFolderLayout.upsert({
    where:  { userId_kind: { userId: session.user.id, kind } },
    create: { userId: session.user.id, kind, data: JSON.stringify(folders) },
    update: { data: JSON.stringify(folders) },
  });

  return NextResponse.json({ ok: true });
}
