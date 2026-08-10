import { createHash } from "crypto";

/**
 * Ключи и вытеснение кеша картинок (см. main/mediaCache).
 *
 * ── Почему отдельно ─────────────────────────────────────────────────────────
 *
 * Кеш перехватывает запросы к `/uploads/*` и отдаёт файлы с диска. Две вещи в
 * нём ошибаются молча и дорого:
 *
 *   • **имя файла в кеше**. Оно приходит из адреса, а адрес — из чужой
 *     страницы. Пропустив в имя `../`, кеш начал бы читать и стирать файлы за
 *     пределами своего каталога;
 *   • **порядок вытеснения**. Ошибись в сравнении — и кеш выбрасывает то, чем
 *     только что пользовались, оставляя давно забытое: занимает место и не
 *     ускоряет ничего.
 *
 * Ни то, ни другое не даёт ошибки на экране. Поэтому решения живут здесь, без
 * обращений к диску и к electron, и покрыты тестами; сам модуль кеша только
 * читает и пишет файлы.
 */

/** Кешируем только картинки: их показывают многократно, и они безопасны. */
export const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

/** Расширение из пути, в нижнем регистре и с точкой. Нет точки — пустая строка. */
export function extensionOf(pathname: string): string {
  const dot = pathname.lastIndexOf(".");
  if (dot < 0) return "";
  return pathname.slice(dot).toLowerCase();
}

/** Тип содержимого по расширению. Не картинка — null, такое не кешируем. */
export function imageTypeFor(pathname: string): string | null {
  return IMAGE_TYPES[extensionOf(pathname)] ?? null;
}

/**
 * Имя файла в кеше: хеш полного адреса плюс исходное расширение.
 *
 * Хеш, а не сам адрес: адрес содержит косые черты и любые символы, и класть его
 * в имя файла нельзя. Полный адрес, а не только путь: одинаковые имена на разных
 * серверах — разные картинки.
 */
export function cacheKeyFor(url: string, ext: string): string {
  return createHash("sha1").update(url).digest("hex") + ext;
}

/**
 * Имя пришло снаружи (из адреса `tzmedia://`) — прежде чем открыть файл,
 * убеждаемся, что это именно наше имя, а не путь наружу.
 */
export function isSafeCacheKey(key: string): boolean {
  return /^[a-f0-9]{40}\.[a-z0-9]{1,5}$/.test(key);
}

export interface CacheEntry {
  key: string;
  size: number;
  /** Время последнего обращения к файлу. */
  atime: number;
}

/**
 * Что удалить, чтобы уложиться в предел.
 *
 * Вытесняем по времени последнего обращения — самое давно не нужное первым.
 * Освобождаем не до самого предела, а до `target` от него (по умолчанию 80%):
 * иначе кеш, наполнившийся под завязку, вытесняет что-нибудь при каждой новой
 * картинке и всё время работает на грани.
 *
 * Возвращается порядок удаления; сам файл стирает вызывающий.
 */
export function evictionPlan(
  entries: CacheEntry[],
  totalBytes: number,
  maxBytes: number,
  target = 0.8,
): string[] {
  if (totalBytes <= maxBytes) return [];
  const limit = maxBytes * target;
  const sorted = [...entries].sort((a, b) => a.atime - b.atime);
  const drop: string[] = [];
  let left = totalBytes;
  for (const entry of sorted) {
    if (left <= limit) break;
    drop.push(entry.key);
    left -= entry.size;
  }
  return drop;
}
