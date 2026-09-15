export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_TOTAL_SIZE = 25 * 1024 * 1024;
export const MAX_FILES = 20;

export const ALLOWED_ATTACHMENTS: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "application/msword": ["doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.ms-excel": ["xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.ms-powerpoint": ["ppt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
  "application/zip": ["zip"],
  "application/x-zip-compressed": ["zip"],
  "text/plain": ["txt"],
  "text/csv": ["csv"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
  "image/svg+xml": ["svg"],
};

export const ALLOWED_EXTENSIONS = Array.from(new Set(Object.values(ALLOWED_ATTACHMENTS).flat()));
export const BLOCKED_EXTENSIONS = ["exe", "bat", "cmd", "com", "scr", "js", "jar", "msi", "vbs", "sh", "ps1", "dll", "pif", "cpl", "app"];

export function extensionOf(name: string): string {
  const i = String(name || "").lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
}

export interface AttachmentMeta { name: string; size: number; mime?: string; }
export interface CheckResult { ok: boolean; error?: string; }

export function checkAttachment(a: AttachmentMeta): CheckResult {
  const ext = extensionOf(a.name);
  if (!ext) return { ok: false, error: `Файл "${a.name}": нет расширения` };
  if (BLOCKED_EXTENSIONS.includes(ext)) return { ok: false, error: `Файл "${a.name}": тип .${ext} запрещён` };
  if (!ALLOWED_EXTENSIONS.includes(ext)) return { ok: false, error: `Файл "${a.name}": тип .${ext} не разрешён` };
  if (a.size > MAX_FILE_SIZE) return { ok: false, error: `Файл "${a.name}" превышает ${formatBytes(MAX_FILE_SIZE)}` };
  return { ok: true };
}

export function checkAttachmentSet(list: AttachmentMeta[]): CheckResult {
  if (list.length > MAX_FILES) return { ok: false, error: `Слишком много файлов (максимум ${MAX_FILES})` };
  let total = 0;
  for (const a of list) { const c = checkAttachment(a); if (!c.ok) return c; total += a.size; }
  if (total > MAX_TOTAL_SIZE) return { ok: false, error: `Суммарный размер вложений превышает ${formatBytes(MAX_TOTAL_SIZE)}` };
  return { ok: true };
}

export function acceptAttribute(): string {
  return [...ALLOWED_EXTENSIONS.map((e) => "." + e), ...Object.keys(ALLOWED_ATTACHMENTS)].join(",");
}
