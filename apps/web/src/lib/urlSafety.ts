/**
 * FIX-OGIMG: проверка адресов, по которым наш сервер ходит наружу.
 *
 * Правила жили внутри `app/api/link-preview/route.ts`, но теперь наружу ходит
 * ещё и прокси картинки превью, а расходиться этим проверкам нельзя: стоит
 * одной из них забыть про внутренние сети, и ссылка вида
 * http://169.254.169.254/latest/meta-data/ заставит сервер принести секреты
 * облака (SSRF).
 */

/** Адреса, до которых серверу ходить нельзя: свои и внутренние сети. */
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // метаданные облака
  return false;
}

/** Разбирает адрес и отклоняет всё, кроме http/https на внешнем хосте. */
export function safeUrl(raw: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (isBlockedHost(parsed.hostname)) return null;
  return parsed;
}
