import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getIO } from "@/lib/socketEmit";

/**
 * FIX-ACT: активность с ПК («Слушает музыку в Spotify»).
 *
 * PATCH { enabled: boolean }        — чекбокс «Показывать мою активность» в настройках.
 * PUT   { activity: string | null } — десктоп-оболочка сообщает текущую активность
 *                                     (и раз в минуту повторяет её как keepalive).
 *
 * Ручной кастомный статус всегда важнее: активность подставляется на чтении
 * только когда customStatus пуст (см. freshActivity в lib/activity.ts).
 */

// FIX-SET: понятное сообщение вместо молчаливого 500, если колонок ещё нет в БД
const DB_HINT = "Не удалось сохранить: база данных не обновлена. Выполните `npx prisma db push` в apps/web и перезапустите сервер.";

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const { enabled } = await req.json();
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        activityEnabled: enabled,
        // Выключили — сразу гасим текущую активность.
        ...(enabled ? {} : { activityStatus: null, activityUpdatedAt: null }),
      },
    });
  } catch {
    return NextResponse.json({ error: DB_HINT }, { status: 500 }); // FIX-SET
  }

  if (!enabled) {
    getIO()?.emit("user-activity-changed", { userId, activity: null });
  }

  return NextResponse.json({ ok: true, enabled });
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const { activity } = await req.json();
  if (activity !== null && typeof activity !== "string") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  let user: { activityEnabled: boolean; activityStatus: string | null } | null = null;
  try {
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: { activityEnabled: true, activityStatus: true },
    });
  } catch {
    return NextResponse.json({ error: DB_HINT }, { status: 500 }); // FIX-SET
  }
  // Чекбокс выключен — молча игнорируем (десктоп шлёт всегда, фильтр здесь).
  if (!user?.activityEnabled) return NextResponse.json({ ok: true, stored: false });

  const value = activity ? activity.slice(0, 80) : null;
  await prisma.user.update({
    where: { id: userId },
    data: { activityStatus: value, activityUpdatedAt: value ? new Date() : null },
  });

  if (value !== user.activityStatus) {
    getIO()?.emit("user-activity-changed", { userId, activity: value });
  }

  return NextResponse.json({ ok: true, stored: true });
}
