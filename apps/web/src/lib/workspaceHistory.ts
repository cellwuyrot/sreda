/**
 * WS-HISTORY: снимки рабочей среды — страховка от потери холста.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Отмена (Ctrl+Z) живёт только в текущей вкладке и исчезает вместе с ней.
 * Истории версий не было вовсе. При этом холст можно потерять целиком: чужим
 * сохранением, неудачным удалением, случайной очисткой. Восстановить было
 * нечем — состояние хранится одной строкой, и прежнего значения после записи не
 * остаётся.
 *
 * ── Правила, которые здесь живут ────────────────────────────────────────────
 *
 * Снимок на каждое сохранение делать нельзя: среда сохраняется раз в 1,2
 * секунды при активной работе, и за час набежало бы три тысячи копий всего
 * холста. Поэтому снимок раз в интервал — редко, но регулярно.
 *
 * Хранить всё тоже нельзя: рабочая среда живёт годами. Держим последние
 * несколько штук — этого хватает, чтобы отыграть сегодняшнюю ошибку, а вчерашняя
 * уже не восстанавливается по памяти («как было?» человек всё равно не помнит).
 *
 * Модуль чистый: ни базы, ни времени по часам процесса. Правила «когда снимать»
 * и «что удалять» — те, на которых легко ошибиться в обе стороны, поэтому они
 * отделены и проверены.
 */

/** Как часто снимаем. Реже — дырки в истории, чаще — копии одного и того же. */
export const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;

/** Сколько снимков держим на владельца. */
export const SNAPSHOT_KEEP = 20;

/** Ключ владельца: человек или общий холст канала. */
export function personalOwnerKey(userId: string): string {
  return userId;
}

export function channelOwnerKey(channelId: string): string {
  return `channel:${channelId}`;
}

/**
 * Пора ли делать снимок.
 *
 * `lastAt` — время последнего снимка этого владельца, null — снимков ещё нет.
 * Первый снимок делается сразу: именно он спасает от «сломал всё в первый же
 * день», когда истории ещё нет.
 */
export function shouldSnapshot(lastAt: Date | null, now: number, intervalMs = SNAPSHOT_INTERVAL_MS): boolean {
  if (!lastAt) return true;
  return now - lastAt.getTime() >= intervalMs;
}

/**
 * Какие снимки удалить, чтобы осталось не больше `keep`.
 *
 * На входе список, отсортированный от новых к старым. Возвращаются
 * идентификаторы лишних — то есть самых старых.
 */
export function snapshotsToDrop(newestFirst: { id: string }[], keep = SNAPSHOT_KEEP): string[] {
  if (newestFirst.length <= keep) return [];
  return newestFirst.slice(keep).map((item) => item.id);
}

/**
 * Пустое состояние сохранять как снимок бессмысленно и опасно: вернувшись к
 * нему, человек получит чистый холст вместо своей работы. Пустым считаем и
 * состояние без единой карточки — оно возникает при сбое загрузки.
 */
export function isSnapshotWorthy(data: string): boolean {
  if (!data || data.length < 2) return false;
  try {
    const parsed = JSON.parse(data) as { boards?: { cards?: unknown[] }[] };
    const boards = Array.isArray(parsed?.boards) ? parsed.boards : [];
    return boards.some((board) => Array.isArray(board?.cards) && board.cards.length > 0);
  } catch {
    return false;
  }
}

export interface SnapshotSummary {
  id: string;
  createdAt: Date;
  /** Размер снимка в байтах — по нему видно, что холст резко «похудел». */
  size: number;
}

/**
 * Сводка для показа в списке. Сами данные наружу не отдаём: список истории
 * открывается часто, а снимок — это весь холст целиком.
 */
export function summarize(rows: { id: string; createdAt: Date; data: string }[]): SnapshotSummary[] {
  return rows.map((row) => ({ id: row.id, createdAt: row.createdAt, size: row.data.length }));
}
