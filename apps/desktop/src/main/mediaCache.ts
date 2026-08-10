import { app, net, protocol, session } from "electron";
/* Имена файлов и порядок вытеснения — в общем модуле, под тестами. */
import {
  IMAGE_TYPES,
  cacheKeyFor as keyFor,
  evictionPlan,
  extensionOf,
  isSafeCacheKey as isSafeKey,
} from "../shared/mediaKeys";
import fs from "fs";
import path from "path";

/**
 * FIX-CLIENTMEDIA: пользовательские изображения рисует клиент, а не сервер.
 *
 * Половина задачи решена на стороне веб-части: `next/image` больше не гоняет
 * каждую аватарку, иконку сообщества и фон через серверный оптимизатор
 * (`/_next/image?url=…`) — см. `images.unoptimized` в apps/web/next.config.mjs.
 * Здесь решается вторая половина: десктоп-клиент держит эти файлы у себя на
 * диске и при повторном показе вообще не ходит в сеть.
 *
 * Как это работает:
 *
 *  1. `onBeforeRequest` следит за GET-запросами к `<origin>/uploads/*`.
 *  2. Файл уже в кеше → запрос перенаправляется на `tzmedia://media/<ключ>`,
 *     который отдаётся с диска. Ни одного байта с сервера.
 *  3. Файла нет → запрос идёт как обычно (поведение прежнее, ничего не может
 *     сломаться), а копия скачивается в фоне и попадёт в кеш к следующему разу.
 *
 * Именно поэтому промах кеша безопасен: мы никогда не подменяем «живой» ответ
 * своим, а лишь добавляем короткий путь для уже виденных файлов. Имена файлов
 * в /uploads — это UUID (см. api/files), содержимое по такому URL не меняется,
 * поэтому кешировать его можно без ограничения по времени.
 *
 * Кеш живёт в userData и ограничен по объёму: при превышении вытесняются самые
 * давно использованные файлы.
 */

export const MEDIA_SCHEME = "tzmedia";

/** Потолок кеша на диске. При превышении вытесняем самые старые файлы. */
const MAX_CACHE_BYTES = 256 * 1024 * 1024;
/** Файл больше этого размера не кешируем — это уже не иконка. */
const MAX_FILE_BYTES = 12 * 1024 * 1024;

let cacheDir = "";
/** Ключ → размер файла. Синхронная проверка попадания без обращения к диску. */
const index = new Map<string, number>();
/** URL-ы, которые прямо сейчас скачиваются в фоне. */
const inFlight = new Set<string>();
let totalBytes = 0;

/**
 * Зарегистрировать схему кеша. Обязано вызываться ДО `app.whenReady()`.
 *
 * `secure` нужен, чтобы https-страница не считала ресурс небезопасным
 * содержимым, `bypassCSP` — чтобы политика `img-src` основной страницы не
 * блокировала картинку из локального кеша.
 */
export function registerMediaCacheScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true },
    },
  ]);
}

/** Прочитать содержимое каталога кеша в индекс (один раз на старте). */
function loadIndex(): void {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    for (const name of fs.readdirSync(cacheDir)) {
      if (!isSafeKey(name)) continue;
      try {
        const stat = fs.statSync(path.join(cacheDir, name));
        index.set(name, stat.size);
        totalBytes += stat.size;
      } catch {
        /* файл исчез между readdir и stat — пропускаем */
      }
    }
  } catch (err) {
    console.warn("[media-cache] не удалось прочитать кеш:", err);
  }
}

/**
 * Вытеснение по времени последнего доступа, пока не уложимся в лимит.
 *
 * Здесь только диск: что именно удалять и в каком порядке решает evictionPlan
 * (см. shared/mediaKeys) — там же это и проверено тестами.
 */
function evictIfNeeded(): void {
  if (totalBytes <= MAX_CACHE_BYTES) return;
  const entries: { key: string; atime: number; size: number }[] = [];
  for (const [key, size] of index) {
    try {
      entries.push({ key, size, atime: fs.statSync(path.join(cacheDir, key)).atimeMs });
    } catch {
      /* Файла нет — считать его занятым местом нельзя. */
      index.delete(key);
      totalBytes -= size;
    }
  }
  for (const key of evictionPlan(entries, totalBytes, MAX_CACHE_BYTES)) {
    try {
      fs.unlinkSync(path.join(cacheDir, key));
    } catch {
      /* уже удалён */
    }
    totalBytes -= index.get(key) ?? 0;
    index.delete(key);
  }
}

/**
 * Фоновая загрузка промаха. Текущий запрос при этом идёт в сеть обычным путём —
 * пользователь ничего не ждёт, а следующий показ уже будет из кеша.
 */
function warmCache(url: string, key: string): void {
  if (inFlight.has(url) || index.has(key)) return;
  inFlight.add(url);
  void (async () => {
    try {
      const res = await net.fetch(url, { bypassCustomProtocolHandlers: true });
      if (!res.ok) return;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > MAX_FILE_BYTES) return;
      const target = path.join(cacheDir, key);
      // Пишем во временный файл и переименовываем: оборванная загрузка не
      // оставит в кеше «половину картинки».
      const tmp = `${target}.part`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, target);
      index.set(key, buf.byteLength);
      totalBytes += buf.byteLength;
      evictIfNeeded();
    } catch {
      /* сеть недоступна или файл удалён — просто не кешируем */
    } finally {
      inFlight.delete(url);
    }
  })();
}

/**
 * Включить кеш. Вызывать после `app.whenReady()` и до создания окна.
 *
 * @param appOrigin origin веб-приложения, например `https://trioz.ru`
 */
export function installMediaCache(appOrigin: string): void {
  cacheDir = path.join(app.getPath("userData"), "media-cache");
  loadIndex();

  protocol.handle(MEDIA_SCHEME, async (request) => {
    let key = "";
    try {
      key = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ""));
    } catch {
      key = "";
    }
    if (!isSafeKey(key)) return new Response(null, { status: 400 });

    const file = path.join(cacheDir, key);
    try {
      const data = await fs.promises.readFile(file);
      // Отметка последнего доступа нужна вытеснению (LRU).
      const now = new Date();
      void fs.promises.utimes(file, now, now).catch(() => {});
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: {
          "Content-Type": IMAGE_TYPES[extensionOf(key)] || "application/octet-stream",
          "Cache-Control": "no-store",
        },
      });
    } catch {
      // Файл пропал из-под нас — сообщаем 404, и картинка просто перерисуется
      // из сети при следующем рендере.
      const size = index.get(key);
      if (size !== undefined) {
        index.delete(key);
        totalBytes -= size;
      }
      return new Response(null, { status: 404 });
    }
  });

  session.defaultSession.webRequest.onBeforeRequest(
    { urls: [`${appOrigin}/uploads/*`] },
    (details, callback) => {
      if (details.method !== "GET") return callback({});
      let ext = "";
      try {
        ext = extensionOf(new URL(details.url).pathname);
      } catch {
        return callback({});
      }
      if (!IMAGE_TYPES[ext]) return callback({});

      const key = keyFor(details.url, ext);
      if (index.has(key)) {
        return callback({ redirectURL: `${MEDIA_SCHEME}://media/${key}` });
      }
      warmCache(details.url, key);
      callback({});
    },
  );
}
