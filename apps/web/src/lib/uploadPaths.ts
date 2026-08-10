/**
 * Куда физически ложатся загруженные файлы и кому их можно отдавать.
 *
 * Всё, что лежит внутри `public/`, Next.js раздаёт статикой сам и без единой
 * проверки. Пока вложения писались туда, ссылка на файл из личной переписки
 * работала у любого, кто её получил, и работала вечно: заголовок стоял
 * `public, max-age=31536000, immutable`, а nginx держал копию ещё семь суток.
 * UUID в имени — это не право доступа, а всего лишь длинный адрес: он утекает
 * вместе с логами, реферером, пересланным сообщением и кэшем прокси.
 *
 * Поэтому каталоги разделены по назначению:
 *
 *   • публичные (аватары, баннеры, иконки сообществ, значки, картинки лендинга)
 *     остаются в `public/uploads` — они и должны открываться без входа: письма,
 *     превью ссылок, страница входа до авторизации;
 *
 *   • приватные (вложения сообщений, голосовые, видео, документы, файлы задач
 *     и проектов) переезжают в `storage/uploads` — каталог вне `public/`, о нём
 *     Next.js ничего не знает, и путь к файлу есть только у обработчика в
 *     server.ts, который сначала спрашивает сессию.
 *
 * Адрес в базе НЕ меняется: как был `/uploads/<каталог>/<файл>`, так и остался.
 * Куда идти за файлом, решает `uploadDirRoot` по имени каталога — поэтому
 * старые сообщения продолжают работать без миграции базы и правок клиента.
 *
 * Чего эта правка НЕ делает: вошедший пользователь, которому дали прямую
 * ссылку, файл всё ещё получит. Проверить право на конкретное вложение сейчас
 * невозможно — вложения сообщений лежат в JSON-поле, обратного пути от адреса
 * файла к каналу или беседе в базе нет. Следующий шаг — подписанные ссылки с
 * коротким сроком жизни, для них потребуется отдельная таблица файлов.
 */

import path from "path";

/**
 * Каталоги, содержимое которых доступно только вошедшему пользователю.
 * Список закрытый: всё, чего здесь нет, считается публичным — так безопаснее
 * ошибиться в сторону лишней проверки, чем открыть лишнее.
 */
export const PRIVATE_UPLOAD_DIRS = [
  "messages",
  "voice",
  "videos",
  "documents",
  "tasks",
  "projects",
  /* WS-ASSETS: вложения рабочей среды. Приватны как всё остальное: право на
     файл считается по записи владельца, а у общего холста — по каналу. */
  "workspace",
] as const;

export type PrivateUploadDir = (typeof PRIVATE_UPLOAD_DIRS)[number];

export function isPrivateUploadDir(dir: string): boolean {
  return (PRIVATE_UPLOAD_DIRS as readonly string[]).includes(dir);
}

/** Корень приватных загрузок: рядом с public, но снаружи него. */
export function privateUploadsRoot(): string {
  return path.join(process.cwd(), "storage", "uploads");
}

/** Корень публичных загрузок — прежний. */
export function publicUploadsRoot(): string {
  return path.join(process.cwd(), "public", "uploads");
}

/** Каталог на диске для конкретного подкаталога загрузок. */
export function uploadDirRoot(dir: string): string {
  return path.join(isPrivateUploadDir(dir) ? privateUploadsRoot() : publicUploadsRoot(), dir);
}

export interface ResolvedUpload {
  /** Абсолютный путь к файлу на диске. */
  filePath: string;
  /** Подкаталог загрузок: messages, avatars и т. д. */
  dir: string;
  /** Требуется ли сессия для выдачи файла. */
  isPrivate: boolean;
}

/**
 * Путь на диске по адресу вида `/uploads/<каталог>/<файл>`.
 *
 * Возвращает null, если адрес не наш, каталог назван подозрительно или имя
 * файла пытается увести за пределы каталога. Разбор строгий и по частям:
 * склейка строк с последующей проверкой префикса — приём рабочий, но он
 * прощает слишком многое, а здесь имя приходит из сети.
 */
export function resolveUploadPath(urlPath: string): ResolvedUpload | null {
  if (!urlPath.startsWith("/uploads/")) return null;

  const rest = urlPath.slice("/uploads/".length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;

  const dir = rest.slice(0, slash);
  const name = rest.slice(slash + 1);
  // Имена каталогов и файлов задаём мы сами: uuid, метка времени, расширение.
  if (!/^[A-Za-z0-9_-]+$/.test(dir)) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null;
  if (name === "." || name === ".." || name.includes("..")) return null;

  const root = uploadDirRoot(dir);
  const filePath = path.join(root, name);
  if (!filePath.startsWith(root + path.sep)) return null;

  return { filePath, dir, isPrivate: isPrivateUploadDir(dir) };
}

/**
 * Тип отдаваемого файла по расширению.
 *
 * ВНИМАНИЕ: `.webm` здесь помечен звуком, и это правильно ТОЛЬКО для голосовых.
 * Видеозаметка тоже `.webm`, поэтому одного расширения недостаточно — см.
 * `uploadContentType`, где тип уточняется по папке.
 */
export const UPLOAD_MIME_TYPES: Record<string, string> = {
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".enc": "application/octet-stream",
  // FIX-DOCS: раньше здесь были только медиафайлы, поэтому документы уходили
  // как application/octet-stream — браузер не умел их показать (в разделе
  // «Документы» открывался белый экран), а скачивание вело себя непредсказуемо.
  // Картинки работали ровно потому, что их типы в списке были.
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".rtf": "application/rtf",
  ".json": "application/json; charset=utf-8",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".zip": "application/zip",
  // FIX-FORMATS: md и rar разрешены в чатах, значит их надо уметь и ОТДАВАТЬ.
  // Без строки здесь файл уходит как application/octet-stream: заметка .md не
  // открывается предпросмотром (в DocsPanel она в списке INLINE_EXT), а на
  // .rar часть браузеров вешает ещё и своё имя файла при сохранении.
  // charset для markdown обязателен: без него кириллица в заметке ломается.
  ".md": "text/markdown; charset=utf-8",
  ".rar": "application/vnd.rar",
  ".7z": "application/x-7z-compressed",
};

/**
 * Тип файла вложения с учётом папки, в которой он лежит.
 *
 * Голосовые и видеозаметки имеют ОДНО расширение `.webm`, а карта типов знает
 * только расширение — поэтому видеозаметка уходила браузеру как `audio/webm`.
 * Для сетевого запроса это не мелочь: тип из ответа выбирает конвейер, и
 * `<video>`, получив звуковой тип, читает файл как звук — картинки нет, кадр
 * нулевого размера, на экране пустой (или «сломанный») квадрат. Именно поэтому у
 * видеосообщения не было превью.
 *
 * Различаем по папке: `videos/` — видео, `voice/` — звук. Раскладывает файлы по
 * этим папкам сам маршрут загрузки (см. api/messages/upload).
 */
export function uploadContentType(dir: string, ext: string): string {
  /* Регистр приводим здесь, а не рассчитываем на вызывающего: расширение приходит
     из имени файла, а имя пришло от человека. */
  const normalized = ext.toLowerCase();
  if (dir === "videos") {
    if (normalized === ".webm") return "video/webm";
    if (normalized === ".ogg") return "video/ogg";
  }
  return UPLOAD_MIME_TYPES[normalized] || "application/octet-stream";
}


export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Разбор заголовка `Range` для отдачи вложения.
 *
 * Нужен голосовым и видеозаметкам: без диапазонов прокрутка внутри записи
 * упирается в уже загруженную часть — браузер просит кусок с нужной секунды, а
 * сервер каждый раз отдаёт файл целиком с начала.
 *
 * Возвращает:
 *   • `null`         — заголовка нет или он невнятный: отдаём файл целиком (200);
 *   • `"unsatisfiable"` — запрошено за пределами файла: по правилам это 416, иначе
 *     проигрыватель будет ждать данные, которых не будет;
 *   • `{ start, end }` — включительные границы куска.
 *
 * Поддержаны все три записи: `bytes=100-200`, `bytes=100-` (до конца) и
 * `bytes=-500` (последние 500 байт). Границы — включительные, как в HTTP: кусок
 * `0-0` — это ровно один байт, и на этом легко ошибиться.
 */
export function parseByteRange(header: string | undefined | null, size: number): ByteRange | "unsatisfiable" | null {
  if (!header || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const rawStart = match[1] ?? "";
  const rawEnd = match[2] ?? "";
  if (!rawStart && !rawEnd) return null;

  let start: number;
  let end: number;
  if (!rawStart) {
    /* Хвост файла. Просьба длиннее файла — отдаём файл целиком, это не ошибка. */
    const tail = Number(rawEnd);
    if (tail <= 0) return "unsatisfiable";
    start = Math.max(0, size - tail);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end: Math.min(end, size - 1) };
}
