import { validateWorkspace, parseWorkspaceRevision } from "@/lib/workspaceValidation";
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
 * (MAX_BOARDS) проверяется на сервере, чтобы его нельзя было обойти через API.
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
  if (Buffer.byteLength(raw, "utf8") > MAX_BYTES) {
    return NextResponse.json({ error: "Состояние рабочей среды слишком большое" }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "data must be valid JSON" }, { status: 400 });
  }

  if (!validateWorkspace(parsed, MAX_BOARDS)) return NextResponse.json({ error: "Invalid workspace schema" }, { status: 400 });
  const data = raw;
  const expected = parseWorkspaceRevision(body?.baseUpdatedAt);
  if (expected === undefined) return NextResponse.json({ error: "Reload this client: workspace revision required" }, { status: 428 });
  // updatedAt is both CAS token and monotonically increasing millisecond clock.
  const updatedAt = new Date(Math.max(Date.now(), (expected?.getTime() ?? 0) + 1));
  try {
    if (expected === null) {
      await prisma.channelWorkspaceState.create({ data: { channelId: channelId, data, updatedAt, updatedById: session.user.id } });
    } else {
      const result = await prisma.channelWorkspaceState.updateMany({
        where: { channelId: channelId, updatedAt: expected },
        data: { data, updatedAt, updatedById: session.user.id },
      });
      if (result.count !== 1) return NextResponse.json({ error: "Workspace changed; merge and retry" }, { status: 409 });
    }
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return NextResponse.json({ error: "Workspace already exists" }, { status: 409 });
    throw error;
  }

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
    updatedAt: updatedAt,
  });

  return NextResponse.json({ ok: true, updatedAt: updatedAt });
}
