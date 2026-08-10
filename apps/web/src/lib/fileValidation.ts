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
