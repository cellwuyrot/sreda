import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  type BlacklistEntry,
  readMailBlacklist,
  writeMailBlacklist,
} from "@/lib/mailBlacklist";

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

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN")
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { ok: true };
}

export async function GET() {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  return NextResponse.json({ entries: readMailBlacklist() });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const body = await req.json().catch(() => ({}));
  const address = String(body?.address ?? "").trim().toLowerCase();
  if (!address) return NextResponse.json({ error: "Укажите адрес или домен" }, { status: 400 });

  const list = readMailBlacklist();
  if (list.some((e) => e.address === address))
    return NextResponse.json({ error: "Адрес уже в чёрном списке" }, { status: 409 });

  const entry: BlacklistEntry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    address,
    note: String(body?.note ?? "").trim().slice(0, 120),
    addedAt: new Date().toISOString(),
  };
  list.push(entry);
  writeMailBlacklist(list);
  return NextResponse.json(entry, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Не указан id" }, { status: 400 });

  const list = readMailBlacklist();
  const next = list.filter((e) => e.id !== id);
  if (next.length === list.length)
    return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  writeMailBlacklist(next);
  return NextResponse.json({ ok: true });
}
