import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import fs from "fs";
import path from "path";

/**
 * MAIL-FOLDERS: пользовательские папки для почтового раздела.
 *
 * Папка — это сохранённый фильтр: имя, цвет и набор условий
 * (направление, содержимое адреса отправителя, тема).
 * Хранится в файле data/mail-folders.json.
 *
 * GET    — список папок.
 * POST   — создать папку.
 * PUT    — обновить папку: { id, ...fields }.
 * DELETE — удалить папку по ?id=...
 */

export type MailFolder = {
  id: string;
  name: string;
  color: string; // hex или CSS-colour
  icon: string;  // emoji
  filter: {
    direction?: "incoming" | "outgoing" | "";
    fromContains?: string;
    toContains?: string;
    subjectContains?: string;
  };
  createdAt: string;
};

const COLORS = ["#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#6366f1"];

function dataPath() {
  return path.join(process.cwd(), "data", "mail-folders.json");
}

function readList(): MailFolder[] {
  try {
    const raw = fs.readFileSync(dataPath(), "utf8");
    return JSON.parse(raw) as MailFolder[];
  } catch {
    return [];
  }
}

function writeList(list: MailFolder[]) {
  const dir = path.dirname(dataPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dataPath(), JSON.stringify(list, null, 2), "utf8");
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN")
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { ok: true };
}

export async function GET() {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  return NextResponse.json({ folders: readList() });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim().slice(0, 40);
  if (!name) return NextResponse.json({ error: "Укажите название папки" }, { status: 400 });

  const list = readList();
  const folder: MailFolder = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    color: String(body?.color ?? COLORS[list.length % COLORS.length]),
    icon: String(body?.icon ?? "📁").slice(0, 4),
    filter: {
      direction: body?.filter?.direction ?? "",
      fromContains: String(body?.filter?.fromContains ?? "").trim(),
      toContains: String(body?.filter?.toContains ?? "").trim(),
      subjectContains: String(body?.filter?.subjectContains ?? "").trim(),
    },
    createdAt: new Date().toISOString(),
  };
  list.push(folder);
  writeList(list);
  return NextResponse.json(folder, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? "");
  if (!id) return NextResponse.json({ error: "Не указан id" }, { status: 400 });

  const list = readList();
  const idx = list.findIndex((f) => f.id === id);
  if (idx === -1) return NextResponse.json({ error: "Папка не найдена" }, { status: 404 });

  const folder = { ...list[idx] };
  if (body?.name) folder.name = String(body.name).trim().slice(0, 40);
  if (body?.color) folder.color = String(body.color);
  if (body?.icon) folder.icon = String(body.icon).slice(0, 4);
  if (body?.filter) {
    folder.filter = {
      direction: body.filter.direction ?? folder.filter.direction,
      fromContains: String(body.filter.fromContains ?? folder.filter.fromContains ?? "").trim(),
      toContains: String(body.filter.toContains ?? folder.filter.toContains ?? "").trim(),
      subjectContains: String(body.filter.subjectContains ?? folder.filter.subjectContains ?? "").trim(),
    };
  }
  list[idx] = folder;
  writeList(list);
  return NextResponse.json(folder);
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Не указан id" }, { status: 400 });

  const list = readList();
  const next = list.filter((f) => f.id !== id);
  if (next.length === list.length)
    return NextResponse.json({ error: "Папка не найдена" }, { status: 404 });
  writeList(next);
  return NextResponse.json({ ok: true });
}
