/**
 * WS-HISTORY: запись и чтение снимков рабочей среды.
 *
 * Правила «когда снимать» и «что удалять» живут в lib/workspaceHistory и
 * проверены тестами. Здесь только работа с базой — и одно важное свойство:
 * **снимок никогда не мешает сохранению**.
 *
 * Причина простая. Снимок — страховка, а сохранение — сама работа человека.
 * Если запись снимка упадёт (кончилось место, база тормозит), это не повод
 * терять правку, ради которой всё затевалось. Поэтому ошибки здесь гасятся и
 * попадают в журнал, а вызывающий про них не знает.
 */

import prisma from "@/lib/prisma";
import {
  isSnapshotWorthy,
  shouldSnapshot,
  snapshotsToDrop,
  summarize,
  type SnapshotSummary,
} from "@/lib/workspaceHistory";

/**
 * Сохранить снимок, если пора. Вызывается после успешной записи состояния.
 *
 * Ничего не возвращает и ничего не бросает: см. заголовок файла.
 */
export async function captureSnapshot(ownerKey: string, data: string, byUserId: string | null): Promise<void> {
  try {
    if (!isSnapshotWorthy(data)) return;

    const last = await prisma.workspaceSnapshot.findFirst({
      where: { ownerKey },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (!shouldSnapshot(last?.createdAt ?? null, Date.now())) return;

    await prisma.workspaceSnapshot.create({ data: { ownerKey, data, byUserId } });

    /* Чистка сразу после записи, а не отдельной задачей по расписанию: лишняя
       служба, о которой надо помнить на новом сервере, — источник «почему-то не
       работает». Здесь же она не может не запуститься. */
    const all = await prisma.workspaceSnapshot.findMany({
      where: { ownerKey },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const drop = snapshotsToDrop(all);
    if (drop.length) {
      await prisma.workspaceSnapshot.deleteMany({ where: { id: { in: drop } } });
    }
  } catch (err) {
    console.warn("[workspace-history] снимок не сохранён:", (err as Error).message);
  }
}

/** Список снимков для показа: время и размер, без самого холста. */
export async function listSnapshots(ownerKey: string): Promise<SnapshotSummary[]> {
  const rows = await prisma.workspaceSnapshot.findMany({
    where: { ownerKey },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, data: true },
  });
  return summarize(Array.isArray(rows) ? rows : []);
}

/**
 * Прочитать снимок для возврата.
 *
 * Владелец проверяется здесь же: без этого по чужому идентификатору снимка
 * можно было бы вытащить чужой холст целиком.
 */
export async function readSnapshot(ownerKey: string, id: string): Promise<string | null> {
  const row = await prisma.workspaceSnapshot.findFirst({
    where: { id, ownerKey },
    select: { data: true },
  });
  return row?.data ?? null;
}
