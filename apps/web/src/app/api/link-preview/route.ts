import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { LRUCache } from "lru-cache";
import { rateLimit } from "@/lib/rateLimit";

/**
 * Превью ссылок: заголовок, описание и картинка страницы по её адресу.
 *
 * Запрос делает сервер, а не браузер, по двум причинам. Из браузера чужой домен
 * закрыт политикой CORS, и превью просто не собралось бы. И, что важнее,
 * прямой запрос из вкладки раскрыл бы адрес читателя владельцу ссылки: достаточно
 * прислать в чат ссылку на свой сервер, чтобы собрать IP всех, кто открыл канал.
 *
 * Раз ходит сервер — он становится инструментом в чужих руках, поэтому:
 *
 * • только http и https, никаких file:, gopher:, data:;
 * • адреса внутренней сети отклоняются. Иначе ссылка вида
 *   http://169.254.169.254/latest/meta-data/ заставила бы сервер сходить в
 *   метаданные облака и принести секреты прямо в чат (SSRF);
 * • ответ читается не целиком, а первыми килобайтами: og-теги живут в <head>,
 *   а качать чужой стомегабайтный файл ради них незачем;
 * • редиректы не следуются автоматически — цель редиректа проверяется теми же
 *   правилами, что и исходный адрес;
 * • результат кладётся в кэш: одну и ту же ссылку в канале открывают десятки
 *   человек, и каждый раз ходить наружу не нужно.
 */

const CACHE = new LRUCache<string, LinkPreview>({ max: 500, ttl: 1000 * 60 * 60 * 6 });

/** Сколько байт ответа читаем: <head> с og-тегами укладывается в этот объём. */
const MAX_BYTES = 128 * 1024;
const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  image: string | null;
  siteName: string;
}

/** Адреса, до которых серверу ходить нельзя: свои и внутренние сети. */
function isBlockedHost(hostname: string): boolean {
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

function safeUrl(raw: string): URL | null {
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

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Достаёт содержимое meta-тега: порядок атрибутов у сайтов разный. */
function metaContent(html: string, key: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1]) return decodeEntities(m[1]).trim();
  }
  return "";
}

async function fetchHead(target: URL, depth = 0): Promise<{ html: string; finalUrl: URL } | null> {
  if (depth > MAX_REDIRECTS) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(target.toString(), {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        // Многие сайты отдают og-теги только «настоящему» браузеру.
        "User-Agent": "Mozilla/5.0 (compatible; TriozBot/1.0; +https://trioz.ru)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return null;
      const next = safeUrl(new URL(location, target).toString());
      if (!next) return null;
      return fetchHead(next, depth + 1);
    }
    if (!res.ok) return null;

    const type = res.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("application/xhtml")) return null;

    // Читаем по кускам и обрываем на MAX_BYTES: целиком чужую страницу не тянем.
    const reader = res.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let html = "";
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      html += decoder.decode(value, { stream: true });
      if (received >= MAX_BYTES || /<\/head>/i.test(html)) break;
    }
    await reader.cancel().catch(() => { /* поток уже закрыт */ });
    return { html, finalUrl: target };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  /* Маршрут ходит наружу по адресу из запроса — без лимита он превратился бы в
     бесплатный сканер чужих сетей от имени нашего сервера. */
  const limited = await rateLimit(req, "link-preview", { limit: 60, windowMs: 60 * 1000 });
  if (limited) return limited;

  const raw = req.nextUrl.searchParams.get("url") || "";
  const target = safeUrl(raw);
  if (!target) return NextResponse.json({ error: "Некорректная ссылка" }, { status: 400 });

  const key = target.toString();
  const cached = CACHE.get(key);
  if (cached) return NextResponse.json(cached);

  const fetched = await fetchHead(target);
  if (!fetched) return NextResponse.json({ error: "Не удалось получить страницу" }, { status: 404 });

  const { html, finalUrl } = fetched;
  const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const image = metaContent(html, "og:image") || metaContent(html, "twitter:image");

  const preview: LinkPreview = {
    url: finalUrl.toString(),
    title: (metaContent(html, "og:title") || (titleTag?.[1] ? decodeEntities(titleTag[1]).trim() : "")).slice(0, 200),
    description: (metaContent(html, "og:description") || metaContent(html, "description")).slice(0, 300),
    /* Картинку тоже пропускаем через проверку адреса: og:image может указывать
       во внутреннюю сеть, и тогда её загрузит уже браузер читателя. */
    image: image && safeUrl(new URL(image, finalUrl).toString()) ? new URL(image, finalUrl).toString() : null,
    siteName: (metaContent(html, "og:site_name") || finalUrl.hostname).slice(0, 100),
  };

  if (!preview.title && !preview.description && !preview.image) {
    return NextResponse.json({ error: "Нечего показать" }, { status: 404 });
  }

  CACHE.set(key, preview);
  return NextResponse.json(preview);
}
