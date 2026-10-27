/** Capabilities of direct conversations. Unsupported secure operations fail closed. */
export function dmCapabilities(kind: string) {
  const personal = kind === "PERSONAL";
  return { search: personal, reactions: personal, threads: false, attachments: kind !== "SECURE", export: personal, quote: personal };
}
// Existing ciphertext versions: 96-bit IV, >=128-bit GCM tag, complete hex bytes.
// This validates an envelope, not the authenticity of ciphertext (only recipients can do that).
export function validDmCiphertext(value: unknown): value is string {
  return typeof value === "string" && /^e2ee:(?:v2:)?[a-f0-9]{24}:(?:[a-f0-9]{2}){16,}$/i.test(value);
}
export function secureDmError(kind: string, content: unknown, attachments?: unknown, quote?: unknown): string | null {
  if (kind !== "SECURE") return null;
  if (attachments != null && (!Array.isArray(attachments) || attachments.length > 0)) return "Вложения в защищённой переписке пока недоступны";
  if (quote != null) return "Открытые цитаты в защищённой переписке запрещены";
  return validDmCiphertext(content) ? null : "Защищённая переписка принимает только зашифрованные сообщения";
}
export function dmPageLimit(raw: string | null, fallback = 50): number {
  const n = Number(raw ?? fallback); return Number.isInteger(n) && n > 0 ? Math.min(n, 100) : fallback;
}
