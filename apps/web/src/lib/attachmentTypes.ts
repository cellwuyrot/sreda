/**
 * Единый список типов вложений чата.
 *
 * До этого модуля список жил в четырёх местах сразу и везде был разный:
 * серверный роут знал одно, `accept` в каналах — другое, `accept` в личных
 * сообщениях — третье. Поэтому в личке можно было ВЫБРАТЬ `.rar`, но нельзя
 * было отправить: сервер отвечал 415 уже после выбора файла. Самый обидный
 * вид ошибки: интерфейс обещает то, чего бэкенд не умеет.
 *
 * Главное решение здесь — разрешать тип ПО РАСШИРЕНИЮ, если MIME от браузера
 * бесполезен. Проверено на живых браузерах:
 *
 *   • `.md`  — Chrome отдаёт пустую строку, Firefox — `text/markdown`, Safari —
 *              `text/plain`. Белый список по MIME такой файл отклоняет в двух
 *              случаях из трёх, а в третьем принимает его как `.txt`.
 *   • `.rar` — почти всегда `application/octet-stream` или пусто: типа для rar нет
 *              в системной таблице большинства ОС.
 *
 * За безопасность отвечает не этот модуль, а проверка содержимого в роуте
 * загрузки (сигнатуры pdf/zip/rar и magic bytes картинок). Расширение здесь —
 * только способ понять НАМЕРЕНИЕ отправителя, а не доверие к имени файла.
 */

/** Картинки. Пережимаются в webp при загрузке. */
export const ATTACHMENT_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/** Голосовые. Тип приходит от MediaRecorder и всегда с кодеками — см. baseMime. */
export const ATTACHMENT_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
]);

/** Видеозаметки и видеофайлы. */
export const ATTACHMENT_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
]);

/**
 * Документы и архивы: MIME → расширение, под которым файл ляжет на диск.
 *
 * Записей больше, чем расширений: у одного формата бывает несколько типов
 * (у rar — три разных, и встречаются все).
 */
export const ATTACHMENT_DOCUMENT_TYPES = new Map<string, string>([
  ["application/pdf", "pdf"],
  ["text/plain", "txt"],
  ["text/csv", "csv"],
  ["application/json", "json"],
  ["application/zip", "zip"],
  ["application/x-zip-compressed", "zip"],
  ["application/x-7z-compressed", "7z"],
  /* rar. Три типа не от хорошей жизни: `application/vnd.rar` — тот, что
     зарегистрирован в IANA, а два других реально присылают Windows и старые
     сборки WinRAR. */
  ["application/vnd.rar", "rar"],
  ["application/x-rar-compressed", "rar"],
  ["application/x-rar", "rar"],
  /* markdown. Фирефокс шлёт `text/markdown`, остальные — пустоту или text/plain,
     поэтому основная работа по md ложится на фоллбэк по расширению ниже. */
  ["text/markdown", "md"],
  ["text/x-markdown", "md"],
  ["application/msword", "doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.ms-excel", "xls"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.ms-powerpoint", "ppt"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
]);

/**
 * Расширение → расширение документа. Фоллбэк, когда MIME ничего не говорит.
 *
 * Здесь только те форматы, что есть в таблице выше: список не расширяет набор
 * разрешённого, а только даёт второй способ опознать то же самое.
 */
const DOCUMENT_EXTENSIONS = new Set([
  "pdf", "txt", "csv", "json", "zip", "7z", "rar", "md",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx",
]);

/** Расширения картинок — нужны, когда браузер не дал тип (бывает на Android). */
const IMAGE_EXTENSIONS = new Map<string, string>([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
]);

/**
 * Расширение имени файла без точки, в нижнем регистре.
 *
 * `"Архив.RAR"` → `"rar"`, `"README"` → `""`, `".gitignore"` → `""`.
 * Последний случай важен: у точки в начале нет имени, и считать «gitignore»
 * расширением нельзя.
 */
export function fileExtension(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Тип без параметров: `video/webm;codecs=vp9` → `video/webm`.
 *
 * MediaRecorder отдаёт тип вместе с кодеками, а списки выше хранят голый
 * контейнер. Заодно нижний регистр: тип присылает клиент, и `VIDEO/WEBM` от
 * него вполне возможен.
 */
export function baseMime(value: string | undefined | null): string {
  return (value ?? "").split(";")[0]!.trim().toLowerCase();
}

export type AttachmentKind = "image" | "audio" | "video" | "document";

export type AttachmentResolution = {
  kind: AttachmentKind;
  /** Расширение для документа (у остальных видов его считает сам роут). */
  ext?: string;
  /** Тип, с которым работать дальше: либо присланный, либо восстановленный. */
  mime: string;
  /** Тип восстановлен по расширению, а не взят из запроса. */
  byExtension: boolean;
};

/**
 * Разрешает вложение: сначала по MIME, потом по расширению.
 *
 * Возвращает `null`, если формат не разрешён ни одним способом.
 *
 * Порядок важен именно такой: если браузер что-то знает о файле, ему больше
 * веры, чем имени. Исключение одно и оно осознанное: `text/plain` у файла `.md`
 * трактуется как markdown — иначе Safari сохранит заметку как `.txt` и получатель
 * скачает файл с чужим именем.
 */
export function resolveAttachment(
  rawMime: string | undefined | null,
  fileName: string,
): AttachmentResolution | null {
  const mime = baseMime(rawMime);
  const ext = fileExtension(fileName);

  if (ATTACHMENT_IMAGE_TYPES.has(mime)) return { kind: "image", mime, byExtension: false };
  if (ATTACHMENT_AUDIO_TYPES.has(mime)) return { kind: "audio", mime, byExtension: false };
  if (ATTACHMENT_VIDEO_TYPES.has(mime)) return { kind: "video", mime, byExtension: false };

  const byMime = ATTACHMENT_DOCUMENT_TYPES.get(mime);
  if (byMime) {
    /* Единственное место, где расширение уточняет тип, а не заменяет его. */
    if (byMime === "txt" && ext === "md") {
      return { kind: "document", ext: "md", mime: "text/markdown", byExtension: true };
    }
    return { kind: "document", ext: byMime, mime, byExtension: false };
  }

  /* Фоллбэк по расширению. Сюда попадают `.md` с пустым типом и `.rar` с
     `application/octet-stream` — ровно те два случая, из-за которых всё и затеялось. */
  if (ext && DOCUMENT_EXTENSIONS.has(ext)) {
    return { kind: "document", ext, mime: documentMimeForExt(ext), byExtension: true };
  }
  const imageMime = ext ? IMAGE_EXTENSIONS.get(ext) : undefined;
  if (imageMime) return { kind: "image", mime: imageMime, byExtension: true };

  return null;
}

/** Каноничный MIME для расширения документа. Используется только в фоллбэке. */
function documentMimeForExt(ext: string): string {
  for (const [mime, mapped] of ATTACHMENT_DOCUMENT_TYPES) {
    if (mapped === ext) return mime;
  }
  return "application/octet-stream";
}

/**
 * Значение `accept` для `<input type="file">` в композерах чата.
 *
 * Собирается из тех же списков, что проверяет сервер, поэтому разойтись с
 * ним уже не может. Расширения перечислены рядом с типами намеренно: без
 * них диалог выбора файла не показывает `.md` и `.rar` — система не знает их
 * типов и не может сопоставить файл со списком.
 */
export const CHAT_ATTACHMENT_ACCEPT = [
  "image/*",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  ".mp4",
  ".webm",
  ".mov",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".csv",
  ".json",
  ".md",
  ".zip",
  ".rar",
  ".7z",
].join(",");

/**
 * Сигнатура RAR.
 *
 * RAR 1.5–4.x: `52 61 72 21 1A 07 00`
 * RAR 5.0+  : `52 61 72 21 1A 07 01 00`
 *
 * Проверять надо именно обе: вторая — формат по умолчанию в WinRAR с 2013 года,
 * а первая всё ещё встречается в старых архивах. Проверка только по RAR5
 * отклонила бы половину реальных файлов.
 */
export function isRar(buffer: Uint8Array): boolean {
  const head = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07];
  if (buffer.length < head.length + 1) return false;
  for (let i = 0; i < head.length; i++) {
    if (buffer[i] !== head[i]) return false;
  }
  if (buffer[6] === 0x00) return true;
  return buffer[6] === 0x01 && buffer[7] === 0x00;
}

/**
 * Сигнатура ZIP: `PK` плюс тип записи.
 *
 * `03` — обычный архив, `05` — пустой, `07` — часть многотомного.
 * Отсюда же проверяются docx/xlsx/pptx: это тот же zip внутри.
 */
export function isZip(buffer: Uint8Array): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && [0x03, 0x05, 0x07].includes(buffer[2]!);
}

/** Сигнатура PDF. */
export function isPdf(buffer: Uint8Array): boolean {
  const head = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  if (buffer.length < head.length) return false;
  return head.every((byte, i) => buffer[i] === byte);
}

/**
 * Проверка содержимого документа по его расширению.
 *
 * Возвращает `null`, если всё в порядке, или текст ошибки для ответа.
 *
 * Форматы без сигнатуры (txt, csv, json, md) не проверяются вовсе — у них её
 * просто нет. Это не дыра: содержимое отдаётся с Content-Disposition и никогда
 * не исполняется браузером.
 */
export function documentSignatureError(ext: string, buffer: Uint8Array): string | null {
  if (ext === "pdf" && !isPdf(buffer)) return "Некорректный PDF-файл";
  if (["zip", "docx", "xlsx", "pptx"].includes(ext) && !isZip(buffer)) {
    return "Содержимое архива не соответствует его типу";
  }
  /* Самая важная строка во всей проверке. Раньше rar просто не доходил сюда,
     а если бы дошёл — проверка zip его бы отклонила: у rar другая сигнатура. */
  if (ext === "rar" && !isRar(buffer)) return "Содержимое архива не соответствует формату RAR";
  return null;
}
