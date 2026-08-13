const MAGIC_BYTES: Record<string, number[][]> = {
  "image/png": [[0x89, 0x50, 0x4e, 0x47]],
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46]], // RIFF header
  "image/gif": [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
  ],
};

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/**
 * Validates that the file's actual bytes match the declared MIME type.
 */
export function validateImageMagicBytes(buffer: Buffer, declaredType: string): boolean {
  const signatures = MAGIC_BYTES[declaredType];
  if (!signatures) return false;

  const basicMatch = signatures.some((sig) =>
    sig.every((byte, i) => buffer.length > i && buffer[i] === byte)
  );

  // Extra check for WebP: RIFF header is shared with WAV/AVI — verify "WEBP" at offset 8
  if (basicMatch && declaredType === "image/webp") {
    if (buffer.length < 12) return false;
    return buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
  }

  return basicMatch;
}

/**
 * Sanitizes a file extension to only contain alphanumeric characters.
 */
export function sanitizeExtension(filename: string): string {
  const raw = filename.split(".").pop() ?? "jpg";
  const cleaned = raw.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return cleaned || "jpg";
}

/**
 * Checks if the declared MIME type is an allowed image type.
 */
export function isAllowedImageType(mimeType: string): boolean {
  return ALLOWED_IMAGE_TYPES.includes(mimeType);
}

/**
 * Full image file validation: type check + magic bytes.
 */
export function validateImageFile(
  buffer: Buffer,
  declaredType: string
): { valid: boolean; error?: string } {
  if (!isAllowedImageType(declaredType)) {
    return { valid: false, error: "Разрешены только PNG, JPG, WebP, GIF" };
  }
  if (!validateImageMagicBytes(buffer, declaredType)) {
    return { valid: false, error: "Содержимое файла не соответствует заявленному типу" };
  }
  return { valid: true };
}

/**
 * Сигнатуры звука и видео.
 *
 * FIX-SEC: содержимое проверялось только у картинок и документов. Заявленного
 * `video/mp4` было достаточно, чтобы положить на сервер любой файл и отдавать
 * его по ссылке с домена сервиса — то есть использовать мессенджер как хранилище
 * чужого содержимого.
 *
 * Неизвестный тип — `null` («нечего сказать»), а не ошибка: список типов живёт
 * в lib/attachmentTypes и растёт, а вот ломать отправку нового формата этой
 * проверкой нельзя.
 */
const MEDIA_MAGIC: Record<string, (b: Buffer) => boolean> = {
  // ISO-BMFF: "ftyp" на смещении 4 — mp4, m4a, mov
  "video/mp4": isoBmff,
  "video/quicktime": isoBmff,
  "audio/mp4": isoBmff,
  "audio/x-m4a": isoBmff,
  // Matroska/WebM
  "video/webm": (b) => starts(b, [0x1a, 0x45, 0xdf, 0xa3]),
  "audio/webm": (b) => starts(b, [0x1a, 0x45, 0xdf, 0xa3]),
  // Ogg
  "audio/ogg": (b) => starts(b, [0x4f, 0x67, 0x67, 0x53]),
  "video/ogg": (b) => starts(b, [0x4f, 0x67, 0x67, 0x53]),
  // MP3: тег ID3 либо сразу кадр (0xFFEx)
  "audio/mpeg": (b) =>
    starts(b, [0x49, 0x44, 0x33]) || (b.length > 1 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  // WAV: RIFF....WAVE
  "audio/wav": isRiffWave,
  "audio/x-wav": isRiffWave,
  // FLAC
  "audio/flac": (b) => starts(b, [0x66, 0x4c, 0x61, 0x43]),
  "audio/x-flac": (b) => starts(b, [0x66, 0x4c, 0x61, 0x43]),
};

function starts(buffer: Buffer, sig: number[]): boolean {
  return sig.every((byte, i) => buffer.length > i && buffer[i] === byte);
}

function isoBmff(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  return (
    buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70
  );
}

function isRiffWave(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (!starts(buffer, [0x52, 0x49, 0x46, 0x46])) return false;
  return buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45;
}

/**
 * Сверяет содержимое звука/видео с заявленным типом.
 * Возвращает текст ошибки либо null, если всё в порядке или тип неизвестен.
 */
export function mediaSignatureError(declaredType: string, buffer: Buffer): string | null {
  const check = MEDIA_MAGIC[declaredType];
  if (!check) return null;
  return check(buffer) ? null : "Содержимое файла не соответствует заявленному типу";
}
