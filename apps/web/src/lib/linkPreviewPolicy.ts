/** Safe metadata only; remote CSS, scripts and arbitrary brand values are never imported. */
export function firstLink(text: string): string | null {
  const match = /https?:\/\/[^\s<>"']+/i.exec(text);
  return match ? match[0].replace(/[.,;:!?)[\]]+$/, "") : null;
}
export function safeBrandColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim())
    ? value.trim()
    : null;
}
export function linkAccent(url: string, declared?: string | null): string {
  const safe = safeBrandColor(declared);
  if (safe) return safe;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return "#63cdd5";
  }
  let n = 0;
  for (const c of host) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${n % 360} 55% 58%)`;
}
export function previewIdentity(scope: string, messageId: string): boolean {
  return (
    (scope === "channel" || scope === "dm") &&
    /^[a-zA-Z0-9_-]{1,100}$/.test(messageId)
  );
}
