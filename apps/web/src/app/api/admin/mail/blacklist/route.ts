import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import fs from "fs";
import path from "path";

/**
 * MAIL-BLACKLIST: чёрный список адресов / доменов.
 *
 * Хранится в файле data/mail-blacklist.json внутри рабочего каталога Next.js.
 * Файл создаётся автоматически при первом POST.
 *
 * GET    — список всех записей.
 * POST   — добавить запись: { address: string, note?: string }.
 * DELETE — удалить запись по ?id=...
 */

type BlacklistEntry = {
  id: string;
  address: string; // email или домен (@example.com)
  note: string;
  addedAt: string;
};

function dataPath() {
  return path.join(process.cwd(), "data", "mail-blacklist.json");
}

function readList(): BlacklistEntry[] {
  try {
    const raw = fs.readFileSync(dataPath(), "utf8");
    return JSON.parse(raw) as BlacklistEntry[];
  } catch {
    return [];
  }
}

function writeList(list: BlacklistEntry[]) {
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
  return NextResponse.json({ entries: readList() });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const body = await req.json().catch(() => ({}));
  const address = String(body?.address ?? "").trim().toLowerCase();
  if (!address) return NextResponse.json({ error: "Укажите адрес или домен" }, { status: 400 });

  const list = readList();
  if (list.some((e) => e.address === address))
    return NextResponse.json({ error: "Адрес уже в чёрном списке" }, { status: 409 });

  const entry: BlacklistEntry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    address,
    note: String(body?.note ?? "").trim().slice(0, 120),
    addedAt: new Date().toISOString(),
  };
  list.push(entry);
  writeList(list);
  return NextResponse.json(entry, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Не указан id" }, { status: 400 });

  const list = readList();
  const next = list.filter((e) => e.id !== id);
  if (next.length === list.length)
    return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  writeList(next);
  return NextResponse.json({ ok: true });
}
