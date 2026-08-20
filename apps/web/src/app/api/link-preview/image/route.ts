import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { safeUrl } from "@/lib/urlSafety";

/**
 * FIX-OGIMG: картинка превью ссылки, принесённая нашим сервером.
 *
 * Раньше в карточку подставлялся адрес og:image как есть, и картинку тянул
 * браузер читателя. Ломалось это постоянно и по трём разным причинам:
 *
 *  • защита от хотлинка. Пол интернета отдаёт картинку только при своём
 *    Referer, а с чужой страницы возвращает 403 — в карточке оставался
 *    крестик «битое изображение»;
 *  • http-адрес на https-странице. Смешанное содержимое браузер не грузит
 *    вовсе, и наш собственный CSP (`img-src ... https:`) его тоже не пускает;
 *  • сама затея противоречила смыслу превью: метаданные мы нарочно берём
 *    сервером, чтобы не раскрывать IP читателя владельцу ссылки, а картинку
 *    при этом запрашивали из вкладки — то есть адрес всё равно утекал.
 *
 * Поэтому файл забирает сервер: с браузерным User-Agent и Referer самого
 * сайта, с теми же проверками адреса, что и метаданные, с ограничением размера
 * и с закрытым списком типов. SVG в список не входит сознательно: он умеет
 * исполнять скрипты, а отдавали бы мы его со своего домена.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
  "image/avif": "image/avif",
  "image/bmp": "image/bmp",
  "image/x-icon": "image/x-icon",
  "image/vnd.microsoft.icon": "image/x-icon",
};

async function fetchImage(target: URL, depth = 0): Promise<Response | null> {
  if (depth > MAX_REDIRECTS) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(target.toString(), {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8",
        /* Referer своего же сайта: именно его ждёт защита от хотлинка. */
        Referer: `${target.protocol}//${target.host}/`,
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return null;
      const next = safeUrl(new URL(location, target).toString());
      if (!next) return null;
      return fetchImage(next, depth + 1);
    }
    if (!res.ok) return null;
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  /* Тот же лимит, что и у метаданных: маршрут ходит по адресу из запроса. */
  const limited = await rateLimit(req, "link-preview-image", { limit: 120, windowMs: 60 * 1000 });
  if (limited) return limited;

  const target = safeUrl(req.nextUrl.searchParams.get("url") || "");
  if (!target) return NextResponse.json({ error: "Некорректная ссылка" }, { status: 400 });

  const upstream = await fetchImage(target);
  if (!upstream) return NextResponse.json({ error: "Картинка недоступна" }, { status: 404 });

  const rawType = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const type = ALLOWED_TYPES[rawType];
  if (!type) return NextResponse.json({ error: "Не картинка" }, { status: 415 });

  const declared = Number(upstream.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) return NextResponse.json({ error: "Слишком большая картинка" }, { status: 413 });

  /* Читаем кусками и обрываем на пределе: заголовку о размере верить нельзя. */
  const reader = upstream.body?.getReader();
  if (!reader) return NextResponse.json({ error: "Картинка недоступна" }, { status: 404 });
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BYTES) {
      await reader.cancel().catch(() => { /* поток уже закрыт */ });
      return NextResponse.json({ error: "Слишком большая картинка" }, { status: 413 });
    }
    chunks.push(value);
  }

  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": type,
      /* Сутки в кеше браузера: одна и та же ссылка в канале открывается
         десятками людей, а картинка превью не меняется. private — потому что
         ответ отдаётся только вошедшему. */
      "Cache-Control": "private, max-age=86400",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
