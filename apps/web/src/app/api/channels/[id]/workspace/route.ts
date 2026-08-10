import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getChannelPermissions } from "@/lib/connectPermissions";
import { emitToChannel } from "@/lib/socketEmit";
import { channelOwnerKey } from "@/lib/workspaceHistory"; // WS-HISTORY
import { captureSnapshot } from "@/lib/workspaceSnapshots"; // WS-HISTORY

/**
 * GROUP-WORKSPACE: совместное состояние «Рабочей среды» (модуль CANVAS) группы.
 *
 * Доступ считается канонически через getChannelPermissions:
 *   - canView  — кто видит/читает холсты (ограничение по ролям; модераторы+ всегда);
 *   - canPost  — кто может редактировать (postAccess: ALL / MOD / ADMIN).
 * Если доступа на чтение нет — 403 (клиент показывает скелетон и ничего больше).
 * Сервер — источник истины: правки без canPost отклоняются, лимит холстов
 * (MAX_BOARDS) обрезается на сервере, чтобы его нельзя было обойти через API.
 */

const MAX_BYTES = 4_000_000; // ~4 МБ на состояние (холсты с рисунками/картинками)
const MAX_BOARDS = 5; // до 5 холстов в разделе

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: channelId } = await params;
  const perms = await getChannelPermissions(session.user.id, channelId);
  if (!perms || perms.channelType !== "CANVAS") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!perms.canView) {
    return NextResponse.json({ error: perms.denialReason || "Нет доступа" }, { status: 403 });
  }

  const state = await prisma.channelWorkspaceState.findUnique({ where: { channelId } });
  return NextResponse.json({
    data: state?.data ?? null,
    updatedAt: state?.updatedAt ?? null,
    canEdit: perms.canPost,
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: channelId } = await params;
  const perms = await getChannelPermissions(session.user.id, channelId);
  if (!perms || perms.channelType !== "CANVAS") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!perms.canView) {
    return NextResponse.json({ error: perms.denialReason || "Нет доступа" }, { status: 403 });
  }
  if (!perms.canPost) {
    return NextResponse.json({ error: "Недостаточно прав для редактирования этой рабочей среды" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const raw = body?.data;
  const clientId = typeof body?.clientId === "string" ? body.clientId : null;

  if (typeof raw !== "string" || raw.length === 0) {
    return NextResponse.json({ error: "data (string) required" }, { status: 400 });
  }
  if (raw.length > MAX_BYTES) {
    return NextResponse.json({ error: "Состояние рабочей среды слишком большое" }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "data must be valid JSON" }, { status: 400 });
  }

  // Обрезаем количество холстов до лимита на сервере — клиентскую проверку
  // обойти нельзя. Работает только для актуального формата (v3 с массивом boards).
  let data = raw;
  if (parsed && typeof parsed === "object" && "boards" in parsed) {
    const p = parsed as { boards?: unknown[]; activeId?: string };
    if (Array.isArray(p.boards) && p.boards.length > MAX_BOARDS) {
      p.boards = p.boards.slice(0, MAX_BOARDS);
      const ids = p.boards.map((b) => (b as { id?: string }).id).filter(Boolean) as string[];
      if (p.activeId && !ids.includes(p.activeId)) p.activeId = ids[0];
      data = JSON.stringify(parsed);
    }
  }

  const state = await prisma.channelWorkspaceState.upsert({
    where: { channelId },
    update: { data, updatedById: session.user.id },
    create: { channelId, data, updatedById: session.user.id },
  });

  /* WS-HISTORY: снимок общего холста раз в интервал. Здесь он нужнее, чем в
     личной среде: холст правят несколько человек, и «кто-то что-то стёр»
     обнаруживается не сразу. Ошибка снимка сохранение не роняет
     (см. lib/workspaceSnapshots), результат не ждём. */
  void captureSnapshot(channelOwnerKey(channelId), data, session.user.id);

  // Совместное редактирование: остальные участники канала подтягивают свежее
  // состояние. Отправитель отсеивает своё эхо по clientId.
  emitToChannel(channelId, "channel-workspace-updated", {
    channelId,
    clientId,
    updatedAt: state.updatedAt,
  });

  return NextResponse.json({ ok: true, updatedAt: state.updatedAt });
}
