/**
 * WS-ASSETS: вложения рабочей среды живут в файловом хранилище, а не в состоянии.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Картинки, PDF и рисунки хранились прямо в карточке строкой `data:` — то есть
 * внутри того же JSON, что и вся рабочая среда. А состояние целиком лежит одной
 * строкой в базе, и на сервере у него жёсткий предел в 2 МБ.
 *
 * Посчитаем. Обычная фотография с телефона — полтора мегабайта. В виде `data:`
 * она занимает на треть больше: около двух. **Одна фотография — и рабочая среда
 * переполнена**, сохранение начинает отвечать отказом. Причём отказ приходит на
 * КАЖДУЮ последующую правку: пока картинку не удалить, не сохраняется вообще
 * ничего, включая заметки и задачи.
 *
 * Вторая беда тише и хуже: при активной работе всё состояние пересобирается и
 * улетает на сервер раз в секунду с небольшим. С картинкой внутри это значит
 * гонять её по сети снова и снова — при каждом сдвиге любой карточки.
 *
 * ── Как стало ───────────────────────────────────────────────────────────────
 *
 * Байты уезжают туда, где и должны быть, — в хранилище загрузок, тем же путём,
 * что вложения переписки: с записью владельца и проверкой права на каждый файл
 * (см. lib/uploadAccess). В карточке остаётся адрес. Состояние худеет на
 * порядки, предел в 2 МБ перестаёт быть потолком для содержимого.
 *
 * Здесь — только чистая часть: разбор `data:`, проверки и подстановка адреса.
 * Загрузка и работа с холстом снаружи, чтобы правило можно было проверить.
 */

/** Типы, которые принимаем во вложения среды. Ключ — тип, значение — расширение. */
export const WORKSPACE_ASSET_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
};

/**
 * Предел на один файл. Двенадцать мегабайт — это заведомо больше любой
 * осмысленной картинки на доске и заведомо меньше того, что имеет смысл держать
 * в оперативной памяти браузера при отрисовке холста.
 */
export const MAX_ASSET_BYTES = 12 * 1024 * 1024;

export interface ParsedDataUrl {
  mime: string;
  /** Тело в base64, без префикса. */
  base64: string;
  /** Расширение файла для этого типа. */
  ext: string;
  /** Размер в байтах после раскодирования. */
  bytes: number;
}

/** Строка вида `data:image/png;base64,…`. */
export function isDataUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:");
}

/** Уже загруженное вложение: адрес в хранилище, а не байты. */
export function isStoredAssetUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/uploads/");
}

/**
 * Размер тела base64 после раскодирования.
 *
 * Считаем формулой, а не раскодированием: строка может быть в десяток
 * мегабайт, и создавать вторую её копию только чтобы узнать длину — расточительно.
 * Каждые 4 символа дают 3 байта, хвостовые «=» вычитаются.
 */
export function base64Bytes(base64: string): number {
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, "");
  if (!clean) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

/**
 * Разбор `data:`-строки. null — не наш случай: не тот формат, неизвестный тип
 * или слишком большой файл. Отказ здесь означает «оставить как есть», а не
 * ошибку: карточка продолжит работать со своей строкой.
 */
export function parseDataUrl(value: unknown, maxBytes = MAX_ASSET_BYTES): ParsedDataUrl | null {
  if (!isDataUrl(value)) return null;
  /* `[\s\S]` вместо флага `s`: цель сборки ниже es2018, и флаг там недоступен. */
  const match = /^data:([a-z0-9.+/-]+);base64,([\s\S]*)$/i.exec(value);
  if (!match) return null;

  const mime = match[1]!.toLowerCase();
  const base64 = match[2]!;
  const ext = WORKSPACE_ASSET_TYPES[mime];
  if (!ext || !base64) return null;

  const bytes = base64Bytes(base64);
  if (bytes <= 0 || bytes > maxBytes) return null;
  return { mime, base64, ext, bytes };
}

/** Карточка в том виде, в каком её касается этот модуль. */
export interface AssetCardLike {
  id: string;
  type: string;
  src?: string;
  docKind?: string;
}

/** Типы карточек, у которых вложение хранится в поле `src`. */
const CARD_TYPES_WITH_ASSET = new Set(["image", "drawing", "document"]);

/**
 * Нужно ли этой карточке переезжать в хранилище.
 *
 * У документа два вида: текстовый живёт прямо в карточке (это и правильно —
 * несколько килобайт), а PDF приходит файлом. Различаем по `docKind`.
 */
export function hasInlineAsset(card: AssetCardLike): boolean {
  if (!CARD_TYPES_WITH_ASSET.has(card.type)) return false;
  if (card.type === "document" && card.docKind !== "pdf") return false;
  return isDataUrl(card.src);
}

/** Карточки текущего холста, которым нужен переезд. */
export function cardsToLift(cards: AssetCardLike[]): AssetCardLike[] {
  return cards.filter(hasInlineAsset);
}

/**
 * Подставить адрес вместо байтов.
 *
 * Возвращается НОВЫЙ объект: карточки на холсте неизменяемы, правка на месте
 * сломала бы сравнение при отрисовке и историю отмены.
 */
export function withAssetUrl<T extends AssetCardLike>(card: T, url: string): T {
  return { ...card, src: url };
}

/**
 * Сколько весит состояние в байтах (как его посчитает сервер).
 *
 * Нужно, чтобы предупредить человека ДО отказа записи: молчаливое «больше
 * ничего не сохраняется» — худшее, что может случиться с рабочей средой.
 */
export function stateBytes(json: string): number {
  return new TextEncoder().encode(json).length;
}
