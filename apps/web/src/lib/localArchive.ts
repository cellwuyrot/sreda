/**
 * ARCHIVE: архив чатов и проектов — на устройстве человека, а не на сервере.
 *
 * Архивация здесь — это два действия сразу:
 *   1. выгрузка содержимого файлом JSON — копия остаётся у человека
 *      на диске и не зависит ни от сервера, ни от аккаунта;
 *   2. скрытие записи из активного списка — чтобы список не рос бесконечно.
 *
 * Почему список скрытых живёт в localStorage, а не в базе: архив — личное
 * дело владельца устройства. Собеседник ничего не замечает, сама переписка на
 * сервере остаётся целой, и новое сообщение вернёт её в список. Этим архив
 * принципиально отличается от безвозвратного удаления, которое стирает переписку
 * у обоих участников и назад уже не откатывается.
 */

/** Что архивируем. У каждого вида свой список: перемешивать их нельзя. */
export type ArchiveKind = "dm" | "business" | "project";

const STORAGE_KEYS: Record<ArchiveKind, string> = {
  dm: "tz-archive-dm",
  business: "tz-archive-business",
  project: "tz-archive-project",
};

/**
 * Событие о изменении архива. Одна и та же запись может быть открыта в двух
 * местах сразу (список и сам чат), и оба должны узнать об архивации.
 */
export const ARCHIVE_EVENT = "tz-archive-change";

/** Предел на всякий случай: localStorage не резиновый. */
const MAX_IDS = 500;

/** Список скрытых идентификаторов. На сервере — всегда пустой. */
export function readArchive(kind: ArchiveKind): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS[kind]);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, MAX_IDS)
      : [];
  } catch {
    return [];
  }
}

function writeArchive(kind: ArchiveKind, ids: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEYS[kind], JSON.stringify(ids.slice(0, MAX_IDS)));
  } catch {
    /* хранилище недоступно (приватный режим) — архив просто не переживёт сеанс */
  }
  try {
    window.dispatchEvent(new CustomEvent(ARCHIVE_EVENT, { detail: { kind } }));
  } catch {
    /* старый движок без CustomEvent — соседний список обновится при следующем открытии */
  }
}

export function isArchived(kind: ArchiveKind, id: string): boolean {
  return readArchive(kind).includes(id);
}

/** Убрать запись из активного списка. Повторный вызов ничего не ломает. */
export function addToArchive(kind: ArchiveKind, id: string): void {
  const current = readArchive(kind);
  if (current.includes(id)) return;
  writeArchive(kind, [id, ...current]);
}

/** Вернуть запись в активный список. */
export function removeFromArchive(kind: ArchiveKind, id: string): void {
  const current = readArchive(kind);
  if (!current.includes(id)) return;
  writeArchive(kind, current.filter((x) => x !== id));
}

/**
 * Имя файла выгрузки: читаемое название плюс дата.
 *
 * Слеши, двоеточия и прочие запрещённые в именах файлов знаки убираются:
 * имя собеседника или проекта человек вводит сам, и в нём может быть что угодно.
 */
export function archiveFileName(prefix: string, title: string): string {
  const clean = (title || "без-названия")
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  const date = new Date().toISOString().slice(0, 10);
  return `${prefix}-${clean}-${date}.json`;
}

/**
 * Сохранить данные файлом на устройство.
 *
 * Ссылка создаётся и сносится в одном действии, blob освобождается через
 * мгновение: Safari не успевает начать скачивание, если адрес отозвать сразу.
 */
export function downloadJson(fileName: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Момент последнего взаимодействия в миллисекундах — единое правило сортировки
 * для списков чатов и проектов.
 *
 * Берётся первая заполненная отметка из переданных по порядку убывания
 * точности: последнее сообщение точнее правки, правка — точнее создания.
 * 0 — отметок нет вовсе; такие записи всегда уходят вниз своей группы.
 */
export function lastActivityAt(...stamps: Array<string | Date | null | undefined>): number {
  for (const stamp of stamps) {
    if (!stamp) continue;
    const time = stamp instanceof Date ? stamp.getTime() : new Date(stamp).getTime();
    if (Number.isFinite(time)) return time;
  }
  return 0;
}
