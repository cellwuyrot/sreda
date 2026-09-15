/** PROJECT-MAIL: правила и проверка вложений. */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_TOTAL_SIZE = 25 * 1024 * 1024;
export const MAX_FILES = 20;

export const ALLOWED_EXTENSIONS = [
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf", "odt",
  "zip", "rar", "7z", "png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "bmp",
];
export const BLOCKED_EXTENSIONS = [
  "exe", "bat", "cmd", "com", "msi", "scr", "js", "mjs", "jar", "sh", "ps1",
  "vbs", "dll", "apk", "app", "deb", "rpm",
];

export function extensionOf(name: string): string {
  const i = (name || "").lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

export interface AttachmentMeta { name: string; size: number; mime: string; }
export type CheckResult = { ok: true } | { ok: false; error: string };

export function checkAttachment(a: AttachmentMeta): CheckResult {
  const ext = extensionOf(a.name);
  if (!a.name || !ext) return { ok: false, error: `Файл без расширения: ${a.name || "без имени"}` };
  if (BLOCKED_EXTENSIONS.includes(ext)) return { ok: false, error: `Запрещённый тип файла: .${ext}` };
  if (!ALLOWED_EXTENSIONS.includes(ext)) return { ok: false, error: `Недопустимое расширение: .${ext}` };
  if (a.size > MAX_FILE_SIZE) return { ok: false, error: `Файл «${a.name}» больше ${formatBytes(MAX_FILE_SIZE)}` };
  if (a.size <= 0) return { ok: false, error: `Пустой файл: ${a.name}` };
  return { ok: true };
}

export function checkAttachmentSet(list: AttachmentMeta[]): CheckResult {
  if (list.length > MAX_FILES) return { ok: false, error: `Слишком много файлов (макс. ${MAX_FILES})` };
  let total = 0;
  for (const a of list) {
    const r = checkAttachment(a);
    if (!r.ok) return r;
    total += a.size;
  }
  if (total > MAX_TOTAL_SIZE) return { ok: false, error: `Общий размер вложений больше ${formatBytes(MAX_TOTAL_SIZE)}` };
  return { ok: true };
}

export function acceptAttribute(): string {
  return ALLOWED_EXTENSIONS.map((e) => "." + e).join(",");
}
