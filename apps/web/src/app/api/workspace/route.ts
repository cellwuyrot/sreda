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
  if (data.length > MAX_BYTES) {
    return NextResponse.json({ error: "Workspace state too large" }, { status: 413 });
  }
  try {
    JSON.parse(data);
  } catch {
    return NextResponse.json({ error: "data must be valid JSON" }, { status: 400 });
  }

  const state = await prisma.workspaceState.upsert({
    where: { userId: session.user.id },
    update: { data },
    create: { userId: session.user.id, data },
  });

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
    updatedAt: state.updatedAt,
  });

  return NextResponse.json({ ok: true, updatedAt: state.updatedAt });
}
