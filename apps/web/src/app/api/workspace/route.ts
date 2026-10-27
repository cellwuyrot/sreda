import { validateWorkspace, parseWorkspaceRevision } from "@/lib/workspaceValidation";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { emitToUser } from "@/lib/socketEmit";
import { personalOwnerKey } from "@/lib/workspaceHistory"; // WS-HISTORY
import { captureSnapshot } from "@/lib/workspaceSnapshots"; // WS-HISTORY

// Серверное хранилище состояния /workspace (доски, карточки, таймер).
// Делает рабочую среду общей для веб-версии и десктоп-клиента.
// Требует модель WorkspaceState в prisma/schema.prisma (см. prisma-additions.prisma).

const MAX_BYTES = 2_000_000; // ~2 МБ на состояние рабочей среды

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const state = await prisma.workspaceState.findUnique({
    where: { userId: session.user.id },
  });

  return NextResponse.json({
    data: state?.data ?? null,
    updatedAt: state?.updatedAt ?? null,
  });
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const data = body?.data;
  const clientId = typeof body?.clientId === "string" ? body.clientId : null;

  if (typeof data !== "string" || data.length === 0) {
    return NextResponse.json({ error: "data (string) required" }, { status: 400 });
  }
  if (Buffer.byteLength(data, "utf8") > MAX_BYTES) {
    return NextResponse.json({ error: "Workspace state too large" }, { status: 413 });
  }
  let parsed: unknown;
  try { parsed = JSON.parse(data); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!validateWorkspace(parsed)) return NextResponse.json({ error: "Invalid workspace schema" }, { status: 400 });
  const expected = parseWorkspaceRevision(body?.baseUpdatedAt);
  if (expected === undefined) return NextResponse.json({ error: "Reload this client: workspace revision required" }, { status: 428 });
  // updatedAt is both CAS token and monotonically increasing millisecond clock.
  const updatedAt = new Date(Math.max(Date.now(), (expected?.getTime() ?? 0) + 1));
  try {
    if (expected === null) {
      await prisma.workspaceState.create({ data: { userId: session.user.id, data, updatedAt } });
    } else {
      const result = await prisma.workspaceState.updateMany({
        where: { userId: session.user.id, updatedAt: expected },
        data: { data, updatedAt },
      });
      if (result.count !== 1) return NextResponse.json({ error: "Workspace changed; merge and retry" }, { status: 409 });
    }
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return NextResponse.json({ error: "Workspace already exists" }, { status: 409 });
    throw error;
  }

  /* WS-HISTORY: снимок раз в интервал — страховка от потери холста. Ошибка
     снимка не мешает сохранению: страховка не должна ронять саму работу
     (см. lib/workspaceSnapshots). Не ждём результат — сохранение человека не
     должно ждать копирования. */
  void captureSnapshot(personalOwnerKey(session.user.id), data, session.user.id);

  // Мгновенная синхронизация между устройствами (веб <-> десктоп):
  // каждое устройство получает событие и подтягивает свежее состояние.
  // Отправитель отфильтровывает своё событие по clientId.
  emitToUser(session.user.id, "workspace-updated", {
    clientId,
    updatedAt: updatedAt,
  });

  return NextResponse.json({ ok: true, updatedAt: updatedAt });
}
