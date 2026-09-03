import { createServer } from "http";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { getToken } from "next-auth/jwt";
import { IncomingMessage } from "http";
import { SOCKET_PATH } from "@trioz/shared";
import { connectRedis, redis } from "./src/lib/redis";
import prisma from "./src/lib/prisma";
import { createReadStream, existsSync, statSync } from "fs";
import { join, extname, sep, basename } from "path";
import { resolveInstallerPath } from "./src/lib/desktopStore";
import { getChannelPermissions } from "./src/lib/connectPermissions";
import { PRIVATE_UPLOAD_DIRS, publicUploadsRoot, resolveUploadPath, uploadContentType, parseByteRange } from "./src/lib/uploadPaths";
import { canAccessUpload } from "./src/lib/uploadAccess";
import { fetchRemote, remoteLocationFor } from "./src/lib/uploadOffload";
import { LRUCache } from "lru-cache";
import { createNotification, createNotificationsBulk } from "./src/lib/createNotification";
import { randomUUID } from "node:crypto";
import { queuePush } from "./src/lib/push";
import { CALL_RING_MS, callSignalKinds } from "./src/lib/callProtocol";

/* Строгий режим выдачи файлов: закрывать те, которых нет в указателе.

   FIX-SEC: теперь включён ПО УМОЛЧАНИЮ. Раньше требовался UPLOADS_STRICT=1, и без
   него вся защита вложений сводилась к «любой вошедший с прямой ссылкой
   получает файл»: настройка по умолчанию и есть то, что работает в жизни.
   Для разбора старой истории режим отключается явно: UPLOADS_STRICT=0. */
const UPLOADS_STRICT = process.env.UPLOADS_STRICT !== "0";
/* Чтобы один неразобранный файл не залил журнал: пишем о нём однажды. */
const warnedUnknownUploads = new LRUCache<string, boolean>({ max: 5_000 });
/* То же для двух других поводов: файл не переехал из public/uploads и файла нет
   на диске вовсе. Одна ссылка запрашивается десятки раз — при открытии
   переписки, при прокрутке, при повторной отрисовке, — и без этого один битый
   файл заполнил бы журнал целиком. */
const warnedLegacyUploads = new LRUCache<string, boolean>({ max: 5_000 });
const warnedMissingUploads = new LRUCache<string, boolean>({ max: 5_000 });

/**
 * Токен сессии из запроса — единственный правильный способ спросить его здесь.
 *
 * `getToken` из next-auth читает cookie ТОЛЬКО из `req.cookies`: в SessionStore
 * (next-auth/core/lib/cookie) все три ветви разбора смотрят именно туда, а
 * заголовок `Cookie` не разбирается вовсе — `headers` нужен там лишь для
 * запасного пути с `Authorization: Bearer`.
 *
 * У сырого `IncomingMessage` поля `cookies` нет: его добавляют Next и Express,
 * а у нас обычный http-сервер. Поэтому вызов `getToken({ req })` без своего
 * разбора всегда возвращает null — то есть «не вошёл» даже для вошедшего.
 *
 * Ровно на этом молча ломалась выдача приватных вложений: каждая картинка
 * получала 401, хотя человек был в аккаунте, а файл лежал на диске. У сокета
 * разбор был написан на месте — поэтому голос работал, а вложения нет. Теперь
 * разбор один на оба пути, и разъехаться им больше нечем.
 */
type CookieCarrier = IncomingMessage & { cookies?: Record<string, string> };

async function sessionTokenFrom(req: IncomingMessage) {
  const carrier = req as CookieCarrier;
  if (!carrier.cookies) {
    const parsed: Record<string, string> = {};
    for (const part of (req.headers.cookie || "").split(";")) {
      const eq = part.indexOf("=");
      // Значение может содержать «=» (base64), имя — нет: режем по первому.
      if (eq <= 0) continue;
      const name = part.slice(0, eq).trim();
      if (name) parsed[name] = part.slice(eq + 1).trim();
    }
    carrier.cookies = parsed;
  }
  return getToken({
    req: carrier as Parameters<typeof getToken>[0]["req"],
    secret: process.env.NEXTAUTH_SECRET,
  });
}

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

interface VoiceUser {
  socketId: string;
  userId: string;
  userName: string;
  muted: boolean;
  /* Аватар участника. Раньше в голосовую комнату он не доезжал вовсе: в
     полезной нагрузке были только имя и идентификатор, поэтому клиенту нечего
     было рисовать, кроме первой буквы имени. */
  avatar: string | null;
  /** FIX-FORCELOCK: состояние принудительной блокировки — видно всем в канале. */
  isForceMuted?: boolean;
  isForceDeafened?: boolean;
}

interface AuthenticatedSocket {
  userId: string;
  userName: string;
  avatar: string | null;
}

const voiceRooms = new Map<string, Map<string, VoiceUser>>();

/**
 * SCREEN-PRIVATE / SCREEN-VIEWERS: состояние активных демонстраций экрана.
 * Ключ — socketId ведущего. `allow` = null означает публичный показ; иначе это
 * список userId, которым трансляция видна (остальным не приходит даже событие
 * о её старте). `viewers` — те, у кого окно показа открыто прямо сейчас.
 */
const screenShareState = new Map<
  string,
  {
    channelId: string;
    allow: Set<string> | null;
    /* SCREEN-PRIVATE-LIVE: качество нужно, чтобы заново объявить показ тем, кому
       ведущий выдал доступ уже во время трансляции. */
    quality: { resolution: number; fps: number };
    viewers: Map<string, { userId: string; userName: string }>;
  }
>();

/** Разослать актуальный состав зрителей ведущему и самим зрителям. */
function broadcastScreenViewers(ownerSocketId: string): void {
  const entry = screenShareState.get(ownerSocketId);
  if (!entry) return;
  // `io` создаётся внутри bootstrap-функции ниже и сразу кладётся в globalThis
  // (там же, откуда его берут API-роуты) — берём ссылку оттуда.
  const server = (globalThis as Record<string, unknown>).__socketio as
    | { to: (room: string) => { emit: (event: string, payload: unknown) => void } }
    | undefined;
  if (!server) return;
  const payload = { ownerSocketId, viewers: Array.from(entry.viewers.values()) };
  server.to(ownerSocketId).emit("screen-viewers", payload);
  for (const sid of entry.viewers.keys()) server.to(sid).emit("screen-viewers", payload);
}
// FIX-GR2: при резком обрыве транспорта присутствие снимается МГНОВЕННО
// (user-left с silent + broadcast для сайдбара) — никакой «иллюзии
// присутствия». Grace-окно отвечает только за звуки: вернулся за
// VOICE_LEAVE_GRACE_MS — тихий реконнект без звуков подключения/отключения;
// не вернулся — собеседникам проигрывается один отложенный звук отключения
// (voice-user-dropped). Ключ — `${userId}:${channelId}`.
const VOICE_LEAVE_GRACE_MS = 8000;
const pendingVoiceLeaves = new Map<string, { timer: ReturnType<typeof setTimeout>; socketId: string }>();
const authenticatedSockets = new Map<string, AuthenticatedSocket>();
const userSockets = new Map<string, Set<string>>();

/* CALL: личные звонки один на один.

   ── Почему не голосовые каналы ───────────────────────────────────────

   Голосовой канал — комната, в которую входят сами и в которую может войти
   любой член сообщества. Звонок — адресованное событие для ДВОИХ, с ожиданием
   ответа и с правом отказаться. Своё состояние нужно именно из-за этого ожидания:
   пока трубку не взяли, обмениваться медиа нельзя, а вызов надо где-то держать.

   ── Почему в памяти, а не в базе ───────────────────────────────────

   Вызов живёт десятки секунд и не переживает перезапуск процесса по своей
   природе: медиа-соединение всё равно рвётся. Запись в базе нужна только для
   истории «пропущенный вызов» — её делает уведомление, а не эта карта.

   Ключ — номер вызова. Один человек может участвовать только в одном звонке: как
   и с телефоном, второй звонящий слышит «занято». */
interface CallSession {
  callId: string;
  callerId: string;
  calleeId: string;
  callerName: string;
  /** Сокет звонящего: именно он ведёт обмен медиа. */
  callerSocketId: string;
  /** Сокет принявшего. До ответа неизвестен: трубку могут взять на любом из устройств. */
  calleeSocketId: string | null;
  video: boolean;
  /** Когда гудок сорвётся сам. Считается один раз на весь вызов: при повторной
      отправке события (приложение только что открыли) гудок не начинается заново. */
  expiresAt: number;
  state: "ringing" | "active";
  /** Автоотмена по истечении звонка. */
  timer: ReturnType<typeof setTimeout>;
}

const activeCalls = new Map<string, CallSession>();
/** userId -> callId. Второй индекс нужен, чтобы проверка «занято» не была перебором. */
const callByUser = new Map<string, string>();

/**
 * Можно ли звонить этому человеку.
 *
 * Звонок — самое навязчивое действие в мессенджере: он будит экран и звенит.
 * Поэтому право звонить уже, чем право написать: только подтверждённые друзья.
 * Любой вошедший с правом будить чужой телефон ночью — готовый инструмент
 * травли, а не удобство.
 *
 * Запреты проверяются в ОБЕ стороны: черный список одного из двоих закрывает
 * звонок целиком — иначе игнор обходится звонком с другой стороны.
 */
async function canCall(callerId: string, calleeId: string): Promise<{ ok: boolean; reason?: string }> {
  if (callerId === calleeId) return { ok: false, reason: "Нельзя позвонить самому себе" };

  const [friendship, ignore, callee] = await Promise.all([
    prisma.friendship.findFirst({
      where: {
        status: "ACCEPTED",
        OR: [
          { senderId: callerId, receiverId: calleeId },
          { senderId: calleeId, receiverId: callerId },
        ],
      },
      select: { id: true },
    }),
    prisma.userIgnore.findFirst({
      where: {
        OR: [
          { userId: callerId, ignoredId: calleeId },
          { userId: calleeId, ignoredId: callerId },
        ],
      },
      select: { id: true },
    }),
    prisma.user.findUnique({
      where: { id: calleeId },
      select: { id: true, banned: true },
    }),
  ]);

  if (!callee) return { ok: false, reason: "Аккаунт не найден" };
  if (callee.banned) return { ok: false, reason: "Аккаунт заблокирован" };
  if (ignore) return { ok: false, reason: "Звонок недоступен" };
  if (!friendship) return { ok: false, reason: "Звонить можно только друзьям" };
  return { ok: true };
}

// ── Access control ─────────────────────────────────────────────────
// channelId -> groupId cache (a channel never moves between groups).
// FIX-MEM: раньше это была неограниченная Map — она росла на каждый новый
// канал и никогда не очищалась (утечка памяти на долгоживущем процессе).
// LRU держит размер под контролем; API get/set совпадает с Map. Вытесненная
// запись при следующем обращении просто перечитывается из БД (getChannelGroupId).
const channelGroups = new LRUCache<string, string>({ max: 20_000 });

async function getChannelGroupId(channelId: string): Promise<string | null> {
  const cached = channelGroups.get(channelId);
  if (cached) return cached;
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { groupId: true },
  });
  if (!channel) return null;
  channelGroups.set(channelId, channel.groupId);
  return channel.groupId;
}

// Short-lived membership cache so frequent events don't hammer the DB.
// NOTE: after a user is kicked from a group, cached access can persist for
// up to MEMBERSHIP_TTL_MS. Lower the TTL if that window matters to you.
// FIX-MEM: неограниченная Map членства/доступа к ЛС росла на каждую пару
// пользователь×группа и пользователь×диалог. LRU ограничивает число записей;
// собственная проверка expires ниже по-прежнему обеспечивает TTL актуальности.
const membershipCache = new LRUCache<string, { ok: boolean; expires: number }>({ max: 50_000 });
/* FIX-SEC: было 60 секунд. Столько же времени исключённый из группы или
   заблокированный продолжал читать переписку по сокету. 15 секунд — разумный
   размен: нагрузка на базу по-прежнему сбита кешем, а окно доступа короче
   вчетверо. Права после исключения сбрасывать точечно здесь нечем: кеш живёт
   в памяти процесса сокет-сервера, �� исключение происходит в процессе Next. */
const MEMBERSHIP_TTL_MS = 15_000;

async function isGroupMember(userId: string, groupId: string): Promise<boolean> {
  const key = `g:${userId}:${groupId}`;
  const cached = membershipCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.ok;
  const member = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
    select: { id: true },
  });
  const ok = member !== null;
  membershipCache.set(key, { ok, expires: Date.now() + MEMBERSHIP_TTL_MS });
  return ok;
}

async function canAccessChannel(userId: string, channelId: string): Promise<boolean> {
  if (typeof channelId !== "string" || !channelId) return false;
  const permission = await getChannelPermissions(userId, channelId);
  return permission?.canView === true;
}

/**
 * Доступ к переписке для сокет-событий (комната набора текста).
 *
 * Правило то же, что в lib/connectPermissions: личная переписка — только двое,
 * деловой разговор по обращению — ещё и вся администрация, потому что очередь
 * заявок общая. Проверку роли делаем только когда участия нет: на личной
 * переписке лишнего запроса не появляется.
 *
 * Копия правила здесь неизбежна: серверу сокетов нельзя тянуть модуль с
 * алиасами `@/`, а кэш членства нужен именно на этой стороне.
 */
async function canAccessConversation(userId: string, convId: string): Promise<boolean> {
  if (typeof convId !== "string" || !convId) return false;
  const key = `dm:${userId}:${convId}`;
  const cached = membershipCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.ok;
  const conv = await prisma.directConversation.findUnique({
    where: { id: convId },
    select: { user1Id: true, user2Id: true, kind: true },
  });
  let ok = conv !== null && (conv.user1Id === userId || conv.user2Id === userId);
  if (!ok && conv?.kind === "BUSINESS") {
    const viewer = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    ok = viewer?.role === "ADMIN" || viewer?.role === "EDITOR";
  }
  membershipCache.set(key, { ok, expires: Date.now() + MEMBERSHIP_TTL_MS });
  return ok;
}

// True when both sockets are currently in the same voice room. WebRTC
// signaling must never be relayed between sockets that don't share one.
function sharedVoiceChannel(socketIdA: string, socketIdB: string): boolean {
  for (const room of voiceRooms.values()) {
    if (room.has(socketIdA) && room.has(socketIdB)) return true;
  }
  return false;
}

// FIX-FLOOD: лёгкий per-socket лимитер высокочастотных событий (typing,
// speaking, WebRTC-сигналинг, join-voice). Скользящее окно хранится прямо в
// socket.data — защищает сервер и остальных участников от флуда с одного
// сокета. Лимиты заданы с запасом, чтобы не мешать легальному трафику.
function socketFlood(
  socket: { data: Record<string, unknown> },
  event: string,
  max: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const bucket = (socket.data.__rl as Record<string, number[]> | undefined) ?? {};
  const hits = (bucket[event] ?? []).filter((t) => t > now - windowMs);
  hits.push(now);
  bucket[event] = hits;
  socket.data.__rl = bucket;
  return hits.length > max;
}

// FIX-DIST: в мульти-инстанс деплое setInterval крутится на КАЖДОМ процессе,
// из-за чего отложенные сообщения могли отправиться несколько раз (гонка
// findMany→create на разных инстансах). Redis-лок (SET NX PX) отдаёт тик ровно
// одному процессу. Без готового Redis лок берётся всегда — это штатный
// одиночный инстанс (voiceRooms и присутствие и так живут в памяти процесса).
async function acquireTaskLock(key: string, ttlMs: number): Promise<boolean> {
  if (redis.status !== "ready") return true;
  try {
    const res = await redis.set(key, String(process.pid), "PX", ttlMs, "NX");
    return res === "OK";
  } catch {
    return true;
  }
}

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [`http://localhost:${port}`, `http://0.0.0.0:${port}`];


/**
 * FIX-DOCS-DL: `?dl=1` превращает раздачу файла в скачивание.
 *
 * Прежняя попытка качать документы через blob в браузере работала, но
 * ломалась в оболочках: в Electron диалог выбора папки открывался, а файл до
 * диска не доходил, а Android DownloadManager схему `blob:` не поддерживает
 * вовсе. Правильное место для решения — сервер: он отдаёт файл с заголовком
 * `Content-Disposition: attachment` и настоящим именем, а клиенту достаточно
 * обычной ссылки. Так работает и браузер, и `downloadURL` в Electron, и
 * DownloadListener в Android.
 */
/**
 * FIX-SEC-UPLOADS: вложения переписки больше не публичная статика.
 *
 * Раньше всё лежало в `public/uploads`, а туда Next.js пускает кого угодно:
 * ссылка на файл из личного сообщения открывалась без входа и жила вечно.
 * Теперь приватные каталоги вынесены в `storage/uploads` (см. lib/uploadPaths),
 * дойти до них можно только этой функцией, и она требует сессию.
 *
 * Проверка — по тому же подписанному токену NextAuth, что и у сокета, поэтому
 * работают и браузер, и Electron, и WebView в Android: cookie у них общие.
 */
/**
 * STORAGE-PRIORITY: отдать файл, лежащий на узле хранения.
 *
 * Возвращает false, если файл не на узле или узел не ответил — тогда
 * вызывающий продолжит со своим «нет файла». Мы намеренно проксируем поток, а
 * не отправляем человека на узел ссылкой: адрес узла не должен попадать к
 * клиенту, иначе прятать серверы за прокси становится бессмысленно, а право на
 * файл проверялось бы уже не нами.
 */
async function serveFromNode(
  relPath: string,
  dir: string,
  isPrivate: boolean,
  req: IncomingMessage,
  res: import("http").ServerResponse,
  query?: URLSearchParams,
): Promise<boolean> {
  let remote: Awaited<ReturnType<typeof remoteLocationFor>> = null;
  try {
    remote = await remoteLocationFor(relPath);
  } catch {
    return false;
  }
  if (!remote) return false;

  try {
    const rangeHeader = typeof req.headers.range === "string" ? req.headers.range : undefined;
    const upstream = await fetchRemote(remote, rangeHeader);

    const headers: import("http").OutgoingHttpHeaders = {
      /* Тип определяем сами, по папке и расширению: у хранилища он мог быть
         записан когда-то давно и другим кодом, а от типа зависит, покажет
         браузер видеозаметку или примет её за звук. */
      "Content-Type": uploadContentType(dir, extname(relPath).toLowerCase()),
      "Cache-Control": isPrivate ? "private, max-age=3600" : "public, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
    };
    const length = upstream.headers.get("content-length");
    if (length) headers["Content-Length"] = Number(length);
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) headers["Content-Range"] = contentRange;

    if (query?.get("dl") === "1") {
      const rawName = (query.get("name") || basename(relPath)).replace(/[\r\n"\\]/g, "").trim().slice(0, 200);
      const safeName = rawName || basename(relPath);
      const asciiName = safeName.replace(/[^\x20-\x7E]/g, "_");
      headers["Content-Disposition"] =
        `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
    }

    if (!upstream.body) {
      res.writeHead(upstream.status === 206 ? 206 : 200, headers);
      res.end(Buffer.from(await upstream.arrayBuffer()));
      return true;
    }

    res.writeHead(upstream.status === 206 ? 206 : 200, headers);
    /* Поток, а не буфер: файл может быть в сотни мегабайт, и складывать его
       целиком в память сервера ради пересылки нельзя. */
    const { Readable } = await import("stream");
    Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
    return true;
  } catch (err) {
    /* Узел не ответил. Это не «файла нет»: он есть, просто сейчас недоступен —
       и клиенту нужно сказать именно это, иначе интерфейс покажет вложение
       удалённым и человек начнёт искать, кто его стёр. */
    if (!warnedMissingUploads.has(`node:${relPath}`)) {
      warnedMissingUploads.set(`node:${relPath}`, true);
      console.warn(`[storage] узел ${remote.nodeName} не отдал файл ${relPath}: ${(err as Error).message}`);
    }
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("Storage node unavailable");
    return true;
  }
}

async function serveUploadedFile(
  urlPath: string,
  req: IncomingMessage,
  res: import("http").ServerResponse,
  query?: URLSearchParams,
): Promise<boolean> {
  const resolved = resolveUploadPath(urlPath);
  if (!resolved) return false;
  const { filePath, isPrivate } = resolved;

  if (isPrivate) {
    const token = await sessionTokenFrom(req);
    if (!token?.id) {
      /* Отвечаем сами, а не проваливаемся в Next: иначе он поищет файл в
         public, не найдёт и отдаст 404 — по нему нельзя отличить «нет файла»
         от «нет доступа», и отладка превращается в гадание. */
      res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end("Unauthorized");
      return true;
    }

    /* Мало того, что человек вошёл: спрашиваем право именно на этот файл —
       канал, беседу или задачу, которой он принадлежит (см. lib/uploadAccess).
       Без этого пересланная ссылка работала у любого участника платформы. */
    const relPath = `${resolved.dir}/${basename(filePath)}`;
    /* Сбой на этом запросе не должен превращать вложение в 500: отсутствующая
       миграция указателя или упавшая база — это повод отдать файл вошедшему по
       прежнему правилу, а не сломать всю переписку. Как и «нет в указателе»,
       такой случай закрывается строгим режимом. */
    let verdict: Awaited<ReturnType<typeof canAccessUpload>>;
    try {
      verdict = await canAccessUpload(token.id as string, relPath);
    } catch (err) {
      verdict = "unknown";
      if (!warnedUnknownUploads.has(relPath)) {
        warnedUnknownUploads.set(relPath, true);
        console.warn(`[uploads] не удалось проверить право на файл ${relPath}:`, err);
      }
    }

    if (verdict === "deny") {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end("Forbidden");
      return true;
    }

    if (verdict === "unknown") {
      /* Файл загружен до появления указателя. Закрыть его сразу значило бы
         стереть историю вложений, поэтому по умолчанию пускаем вошедшего и
         пишем в журнал — по этим записям видно, что осталось разобрать
         (scripts/backfill-upload-index.mjs). После разбора включается
         UPLOADS_STRICT (включён по умолчанию; отключается UPLOADS_STRICT=0), и неизвестные файлы закрываются. */
      if (UPLOADS_STRICT) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        res.end("Forbidden");
        return true;
      }
      if (!warnedUnknownUploads.has(relPath)) {
        warnedUnknownUploads.set(relPath, true);
        console.warn(`[uploads] файла нет в указателе, отдан по факту входа: ${relPath}`);
      }
    }
  }

  /* Файла нет там, где мы его ждём. Два разных случая, и раньше оба молча
     проваливались в Next — тот искал файл в public, не находил и отдавал 404.
     По такому 404 нельзя отличить «файл удалён» от «файл не переехал», и
     разбираться приходилось гаданием.

     1. Приватные вложения переехали из public/uploads в storage/uploads
        (lib/uploadPaths). Перенос уже загруженных файлов делается руками
        (docs/server-actions.md, шаг 3), и пока он не сделан, файл лежит по
        старому адресу. Отдаём его оттуда — с той же проверкой сессии и права:
        путь другой, правила те же.

     2. Файла нет ни там, ни там. Это либо ручное удаление, либо след прежней
        автоочистки вложений (она удаляла файлы старше 14 дней крупнее 1 МБ;
        сама очистка отозвана, но удалённое ею не вернуть). Пишем об этом прямо
        — по журналу видно, что случилось, без догадок. */
  let servePath = filePath;
  if (!existsSync(servePath)) {
    const relMissing = `${resolved.dir}/${basename(filePath)}`;
    const legacyPath = isPrivate ? join(publicUploadsRoot(), resolved.dir, basename(filePath)) : null;
    if (legacyPath && existsSync(legacyPath)) {
      servePath = legacyPath;
      if (!warnedLegacyUploads.has(relMissing)) {
        warnedLegacyUploads.set(relMissing, true);
        console.warn(`[uploads] файл всё ещё в public/uploads, отдан оттуда: ${relMissing} — перенесите каталог, см. docs/server-actions.md, шаг 3`);
      }
    } else if (await serveFromNode(relMissing, resolved.dir, isPrivate, req, res, query)) {
      /* STORAGE-PRIORITY: файла нет на диске, потому что он уехал на узел
         хранения. Адрес вложения при переезде не меняется — место знает только
         раздатчик, и здесь он это место находит. Проверка права уже пройдена
         выше: она смотрит в указатель, а не на диск, и от места не зависит. */
      return true;
    } else {
      if (!warnedMissingUploads.has(relMissing)) {
        warnedMissingUploads.set(relMissing, true);
        console.warn(`[uploads] файла нет на диске: ${relMissing}`);
      }
      /* Отвечаем сами: 404 от Next по этому адресу неотличим от «нет доступа»,
         а клиенту нужно показать человеку разную причину. */
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end("Not Found");
      return true;
    }
  }
  const filePathOnDisk = servePath;
  try {
    const stat = statSync(filePathOnDisk);
    if (!stat.isFile()) return false;
    const ext = extname(filePathOnDisk).toLowerCase();
    const contentType = uploadContentType(resolved.dir, ext);
    // Тип строго тот, что принимает writeHead: у OutgoingHttpHeaders есть
    // именованные поля (например set-cookie: string | string[]), поэтому
    // Record<string, string | number> к нему не приводится.
    const headers: import("http").OutgoingHttpHeaders = {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      /* Приватный файл не должен оседать в общих кэшах: `public` разрешал
         nginx и любому прокси по пути держать копию и отдавать её кому угодно.
         Браузеру пользователя кэшировать можно — это его собственный диск. */
      "Cache-Control": isPrivate ? "private, max-age=3600" : "public, max-age=31536000, immutable",
    };
    if (query?.get("dl") === "1") {
      // Имя приходит от клиента, поэтому вычищаем всё, чем можно сломать
      // заголовок (перевод строки, кавычки, обратный слэш).
      const rawName = (query.get("name") || basename(filePathOnDisk)).replace(/[\r\n"\\]/g, "").trim().slice(0, 200);
      const safeName = rawName || basename(filePathOnDisk);
      // ASCII-вариант для старых клиентов + RFC 5987 для юникодных имён.
      const asciiName = safeName.replace(/[^\x20-\x7E]/g, "_");
      headers["Content-Disposition"] =
        `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
    }
    /* Диапазоны байт. Без них прокрутка внутри голосового или видеосообщения
       упирается в уже загруженную часть: браузер спрашивает кусок с нужной
       секунды, а сервер каждый раз отдаёт файл целиком с начала. Стоимость
       поддержки — десять строк, а без неё полоса прокрутки в заметке
       бесполезна. */
    headers["Accept-Ranges"] = "bytes";
    /* Разбор заголовка живёт в библиотеке и покрыт тестами: на включительных
       границах HTTP легко ошибиться на единицу, а ошибка проявится как «видео не
       проигрывается с середины». */
    const range = parseByteRange(
      typeof req.headers.range === "string" ? req.headers.range : null,
      stat.size,
    );
    if (range === "unsatisfiable") {
      res.writeHead(416, { "Content-Range": `bytes */${stat.size}`, "Cache-Control": "no-store" });
      res.end();
      return true;
    }
    if (range) {
      headers["Content-Length"] = range.end - range.start + 1;
      headers["Content-Range"] = `bytes ${range.start}-${range.end}/${stat.size}`;
      res.writeHead(206, headers);
      createReadStream(filePathOnDisk, { start: range.start, end: range.end }).pipe(res);
      return true;
    }

    res.writeHead(200, headers);
    createReadStream(filePathOnDisk).pipe(res);
    return true;
  } catch {
    return false;
  }
}

// ── Self-hosted desktop installers (/desktop/) ─────────────────────────────
// electron-builder publishes installers + the auto-update feed (latest*.yml,
// *.blockmap, the nsis-web *.7z package) to `publish.url` = /desktop/. Serving
// them from here keeps the whole desktop distribution on our own domain — the
// /about download and the app's self-updater never touch GitHub. Installers are
// streamed with range support so browsers can resume large downloads.
//
// File resolution goes through `resolveInstallerPath` (src/lib/desktopStore) so
// this handler and the /api/download/desktop route agree on exactly which
// directories hold installers and never drift apart.
const DESKTOP_MIME: Record<string, string> = {
  ".exe": "application/vnd.microsoft.portable-executable",
  ".dmg": "application/x-apple-diskimage",
  ".zip": "application/zip",
  ".appimage": "application/octet-stream",
  ".deb": "application/vnd.debian.binary-package",
  ".7z": "application/x-7z-compressed",
  ".blockmap": "application/octet-stream",
  ".yml": "text/yaml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
};

// Extensions we hand to the browser as a download rather than rendering inline.
const DESKTOP_ATTACHMENT = new Set([".exe", ".dmg", ".zip", ".appimage", ".deb"]);

function serveDesktopFile(
  urlPath: string,
  req: IncomingMessage,
  res: import("http").ServerResponse,
): boolean {
  if (urlPath !== "/desktop" && !urlPath.startsWith("/desktop/")) return false;

  let rel: string;
  try {
    rel = decodeURIComponent(urlPath.replace(/^\/desktop\/?/, ""));
  } catch {
    return false;
  }
  if (!rel) return false; // no directory listing

  // Resolve across the store directories (traversal-guarded, installer files
  // only). Returns null if the file isn't found in any of them.
  const target = resolveInstallerPath(rel);
  if (!target) return false;

  try {
    const stat = statSync(target);
    if (!stat.isFile()) return false;
    const ext = extname(target).toLowerCase();
    const contentType = DESKTOP_MIME[ext] || "application/octet-stream";
    const baseHeaders: Record<string, string | number> = {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=300",
    };
    if (DESKTOP_ATTACHMENT.has(ext)) {
      const name = target.split(sep).pop() || "download";
      const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
      baseHeaders["Content-Disposition"] =
        `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
    }

    // Range request — stream the requested slice so downloads are resumable.
    const range = req.headers.range;
    const match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
      if (
        Number.isNaN(start) ||
        Number.isNaN(end) ||
        start > end ||
        end >= stat.size
      ) {
        res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
        res.end();
        return true;
      }
      res.writeHead(206, {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Content-Length": end - start + 1,
      });
      createReadStream(target, { start, end }).pipe(res);
      return true;
    }

    res.writeHead(200, { ...baseHeaders, "Content-Length": stat.size });
    createReadStream(target).pipe(res);
    return true;
  } catch {
    return false;
  }
}

app.prepare().then(() => {
  /* FIX-SEC-UPLOADS: пока старые файлы не перенесены, их по-прежнему раздаёт
     Next.js прямо из public — проверка входа в этом случае просто не
     вызывается. Молчать нельзя: снаружи развёртывание выглядит рабочим, а
     доступ остаётся открытым. Порядок переноса — в docs/server-actions.md. */
  const leftovers = PRIVATE_UPLOAD_DIRS.filter((dir) => existsSync(join(publicUploadsRoot(), dir)));
  if (leftovers.length > 0) {
    console.warn(
      `[SECURITY] В public/uploads остались приватные каталоги: ${leftovers.join(", ")}. ` +
        "Пока они там, вложения раздаются без проверки входа — перенесите их в storage/uploads " +
        "(инструкция: docs/server-actions.md).",
    );
  }

  const httpServer = createServer(async (req, res) => {
    try {
      const url = req.url || "";
      const pathOnly = url.split("?")[0];
      const queryIndex = url.indexOf("?");
      const query = queryIndex >= 0 ? new URLSearchParams(url.slice(queryIndex + 1)) : undefined;
      if (await serveUploadedFile(pathOnly, req, res, query)) return;
      if (serveDesktopFile(pathOnly, req, res)) return;
      await handle(req, res);
    } catch (err) {
      console.error("[HTTP] Request handler error:", err);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true,
    },
    path: SOCKET_PATH,
  });

  // Export io globally so API routes can emit events
  // Set BEFORE any request can be processed (prepare() is already done)
  (globalThis as Record<string, unknown>).__socketio = io;
  (globalThis as Record<string, unknown>).__socketioReady = true;

  // Scoped replacement for the old global io.emit: voice presence is only
  // sent to members of the channel's group (room `group-<groupId>`) and to
  // the current participants of the voice room itself.
  // FIX-PRES: groupId разрешается через getChannelGroupId (при холодном кеше —
  // одно обращение к БД), а не читается из channelGroups напрямую. Раньше, пока
  // кеш пуст (getChannelGroupId звался только из get-all-voice-users), рассылка
  // после выхода уходила ТОЛЬКО в voice-комнату — сайдбары остальных членов
  // группы обновление не получали, и ник вышедшего «висел» до следующего опроса.
  async function broadcastVoiceChannelUsers(channelId: string) {
    const room = voiceRooms.get(channelId);
    const users = room ? Array.from(room.values()) : [];
    let groupId: string | null = null;
    try {
      groupId = await getChannelGroupId(channelId);
    } catch { /* канал мог быть удалён — шлём хотя бы участникам комнаты */ }
    if (groupId) {
      io.to(`group-${groupId}`).to(`voice-${channelId}`).emit("voice-channel-users", { channelId, users });
    } else {
      io.to(`voice-${channelId}`).emit("voice-channel-users", { channelId, users });
    }
  }


  // FIX-FORCELOCK-V2: после обновления voiceRooms шлём событие напрямую всем сокетам
  // целевого пользователя через userSockets — это надёжнее emitToUser из API-маршрута,
  // который может не найти io через getIO() в контексте Next.js App Router.
  (globalThis as Record<string, unknown>).__forceMuteUser = (channelId: string, targetUserId: string, deafen: boolean) => {
    const room = voiceRooms.get(channelId);
    if (!room) return;
    for (const user of room.values()) {
      if (user.userId === targetUserId) {
        user.isForceMuted = true;
        if (deafen) user.isForceDeafened = true;
        // Прямая доставка: перебираем все активные сокеты пользователя
        const sockets = userSockets.get(targetUserId);
        if (sockets) {
          const evt = deafen ? "voice:force-deafen" : "voice:force-mute";
          for (const sid of Array.from(sockets)) {
            io.to(sid).emit(evt, {});
          }
        }
        break;
      }
    }
    void broadcastVoiceChannelUsers(channelId);
  };

  (globalThis as Record<string, unknown>).__forceUnmuteUser = (channelId: string, targetUserId: string, includeDeafen: boolean) => {
    const room = voiceRooms.get(channelId);
    if (!room) return;
    for (const user of room.values()) {
      if (user.userId === targetUserId) {
        user.isForceMuted = false;
        if (includeDeafen) user.isForceDeafened = false;
        // Прямая доставка разблокировки
        const sockets = userSockets.get(targetUserId);
        if (sockets) {
          const evt = includeDeafen ? "voice:force-undeafen" : "voice:force-unmute";
          for (const sid of Array.from(sockets)) {
            io.to(sid).emit(evt, {});
          }
        }
        break;
      }
    }
    void broadcastVoiceChannelUsers(channelId);
  };

  // Force-kick everyone out of a voice channel when it is deleted (called from API routes)
  (globalThis as Record<string, unknown>).__kickVoiceChannel = (channelId: string) => {
    const room = `voice-${channelId}`;
    io.to(room).emit("voice-channel-deleted", { channelId });
    io.in(room).socketsLeave(room);
    voiceRooms.delete(channelId);
    void broadcastVoiceChannelUsers(channelId);
  };

  // Global ban: notify the renderer first so it can switch to the restricted
  // appeal screen, then terminate every socket belonging to this account.
  (globalThis as Record<string, unknown>).__revokeAccountSession = (userId: string, payload: unknown) => {
    io.to(`dm-${userId}`).emit("account-session-revoked", payload);
    setTimeout(() => {
      for (const socketId of Array.from(userSockets.get(userId) ?? [])) {
        io.sockets.sockets.get(socketId)?.disconnect(true);
      }
    }, 180);
  };

  // Group ban: invalidate membership cache and synchronously evict every user
  // socket from chat/group/voice rooms. The account itself remains signed in.
  (globalThis as Record<string, unknown>).__revokeGroupSession = (
    userId: string,
    groupId: string,
    channelIds: string[],
    payload: unknown,
  ) => {
    membershipCache.delete(`g:${userId}:${groupId}`);
    io.to(`dm-${userId}`).emit("group-session-revoked", payload);
    const ids = new Set(channelIds);
    for (const socketId of Array.from(userSockets.get(userId) ?? [])) {
      const userSocket = io.sockets.sockets.get(socketId);
      userSocket?.leave(`group-${groupId}`);
      for (const channelId of ids) {
        userSocket?.leave(`channel-${channelId}`);
        const room = voiceRooms.get(channelId);
        const voiceUser = room?.get(socketId);
        if (room && voiceUser) {
          room.delete(socketId);
          userSocket?.leave(`voice-${channelId}`);
          io.to(`voice-${channelId}`).emit("user-left", { socketId });
          if (room.size === 0) voiceRooms.delete(channelId);
          void broadcastVoiceChannelUsers(channelId);
        }
      }
    }
  };

  // Presence: API-роуты спрашивают, смотрит ли пользователь канал прямо сейчас,
  // чтобы не создавать ему уведомление об упоминании/ответе в открытом канале.
  (globalThis as Record<string, unknown>).__isUserInChannel = async (
    userId: string,
    channelId: string
  ): Promise<boolean> => {
    try {
      const sockets = await io.in("channel-" + channelId).fetchSockets();
      return sockets.some((s) => authenticatedSockets.get(s.id)?.userId === userId);
    } catch {
      return false;
    }
  };

  io.use(async (socket, next) => {
    try {
      const token = await sessionTokenFrom(socket.request as IncomingMessage);
      if (!token || !token.id) {
        return next(new Error("Authentication required"));
      }

      // JWT sessions are otherwise valid until expiry. Reject a banned account
      // even if it tries to open a fresh socket with an old token.
      /* Аватар берём тем же запросом, что уже идёт при подключении: отдельный
         поход в базу ради картинки был бы лишним, а без неё голосовая комната
         показывает вместо людей одни буквы. */
      const liveUser = await prisma.user.findUnique({
        where: { id: token.id as string },
        select: { banned: true, bannedUntil: true, avatar: true },
      });
      const activelyBanned = !!liveUser?.banned && (!liveUser.bannedUntil || liveUser.bannedUntil > new Date());
      if (activelyBanned) return next(new Error("Account session revoked"));

      authenticatedSockets.set(socket.id, {
        userId: token.id as string,
        userName: (token.name || token.username || "Unknown") as string,
        avatar: liveUser?.avatar ?? null,
      });

      next();
    } catch {
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    const authData = authenticatedSockets.get(socket.id);
    if (!authData) {
      socket.disconnect(true);
      return;
    }
    console.log(`[Socket] Connected: ${socket.id} (user: ${authData.userId})`);

    // Track user -> sockets mapping for targeted notifications
    if (!userSockets.has(authData.userId)) {
      userSockets.set(authData.userId, new Set());
    }
    userSockets.get(authData.userId)!.add(socket.id);

    // ── DM room ───────────────────────────────────────────────────────────
    socket.join(`dm-${authData.userId}`);

    /* CALL: вызов мог прийти в ЗАКРЫТОЕ приложение — тогда событие call-incoming
       ушло в пустую комнату, а человек увидел только окно поверх блокировки и
       нажал «Ответить». Страница открывается с нуля и о вызове не знает ничего,
       поэтому текущий вызов повторяется сразу после подключения. Без этого
       трубку на закрытом телефоне взять было бы невозможно в принципе. */
    const pendingCallId = callByUser.get(authData.userId);
    const pendingCall = pendingCallId ? activeCalls.get(pendingCallId) : undefined;
    if (pendingCall && pendingCall.state === "ringing" && pendingCall.calleeId === authData.userId) {
      socket.emit("call-incoming", {
        callId: pendingCall.callId,
        from: {
          userId: pendingCall.callerId,
          userName: pendingCall.callerName,
          avatar: null,
        },
        video: pendingCall.video,
        expiresAt: pendingCall.expiresAt,
      });
    }

    // DM typing indicators — relay to the other participant via their dm room
    socket.on("dm-typing", ({ convId }: { convId: string }) => {
      if (typeof convId !== "string" || !convId) return;
      if (socketFlood(socket, "dm-typing", 30, 10_000)) return;
      // FIX-AUTHZ: ретранслируем индикатор набора только если сокет реально
      // состоит в комнате диалога. Вступление в неё (join-dm-conv) проверяет
      // участие через canAccessConversation — значит слать dm-typing в чужой
      // диалог больше нельзя. Раньше клиент мог указать любой convId.
      if (!socket.rooms.has(`dm-conv-${convId}`)) return;
      socket.to(`dm-conv-${convId}`).emit("dm-typing", {
        userId: authData.userId,
        userName: authData.userName,
      });
    });

    socket.on("dm-stop-typing", ({ convId }: { convId: string }) => {
      if (typeof convId !== "string" || !convId) return;
      if (socketFlood(socket, "dm-typing", 30, 10_000)) return;
      if (!socket.rooms.has(`dm-conv-${convId}`)) return;
      socket.to(`dm-conv-${convId}`).emit("dm-stop-typing", {
        userId: authData.userId,
      });
    });

    // Join a DM conversation room so typing events are scoped to participants.
    // Only actual participants of the conversation may join its room.
    socket.on("join-dm-conv", async ({ convId }: { convId: string }) => {
      if (!(await canAccessConversation(authData.userId, convId))) return;
      socket.join(`dm-conv-${convId}`);
    });

    socket.on("leave-dm-conv", ({ convId }: { convId: string }) => {
      socket.leave(`dm-conv-${convId}`);
    });

    // ── Voice channels ──────────────────────────────────────────────
    // Only group members may join a channel room (messages/typing events).
    socket.on("join-channel", async ({ channelId }: { channelId: string }) => {
      if (!(await canAccessChannel(authData.userId, channelId))) return;
      socket.join(`channel-${channelId}`);
    });

    socket.on("leave-channel", ({ channelId }: { channelId: string }) => {
      socket.leave(`channel-${channelId}`);
    });

    // Group rooms: scope sidebar voice previews ("voice-channel-users") to
    // group members only. Clients emit this for every group they display.
    socket.on("join-group", async ({ groupId }: { groupId: string }) => {
      if (typeof groupId !== "string" || !groupId) return;
      if (!(await isGroupMember(authData.userId, groupId))) return;
      socket.join(`group-${groupId}`);
    });

    socket.on("leave-group", ({ groupId }: { groupId: string }) => {
      if (typeof groupId !== "string") return;
      socket.leave(`group-${groupId}`);
    });

    socket.on("typing", ({ channelId }: { channelId: string }) => {
      if (socketFlood(socket, "typing", 30, 10_000)) return;
      if (!socket.rooms.has(`channel-${channelId}`)) return;
      socket.to(`channel-${channelId}`).emit("user-typing", {
        userId: authData.userId,
        userName: authData.userName,
        channelId,
      });
    });

    socket.on("stop-typing", ({ channelId }: { channelId: string }) => {
      if (socketFlood(socket, "typing", 30, 10_000)) return;
      if (!socket.rooms.has(`channel-${channelId}`)) return;
      socket.to(`channel-${channelId}`).emit("user-stop-typing", {
        userId: authData.userId,
        channelId,
      });
    });

    // Lightweight RTT probe: the client measures a Socket.IO round-trip for
    // the sidebar ping indicator when no WebRTC peers are connected yet.
    socket.on("voice-ping", (ack?: () => void) => {
      if (typeof ack === "function") ack();
    });

    // ── Voice: join/leave ─────────────────────────────────────────────
    // Membership is verified against the channel's group before joining.
    socket.on("join-voice", async ({ channelId }: { channelId: string }) => {
      if (typeof channelId !== "string" || !channelId) return;
      // FIX-FLOOD: защита от спама быстрыми переключениями каналов.
      if (socketFlood(socket, "join-voice", 20, 10_000)) return;
      // Async permission checks can overlap when a user clicks two channels
      // quickly. Only the newest request from this socket is allowed to commit.
      const joinSerial = Number(socket.data.voiceJoinSerial ?? 0) + 1;
      socket.data.voiceJoinSerial = joinSerial;

      // A user/account may exist in exactly one voice room. The previous code
      // only removed duplicate sessions inside the destination room, leaving
      // stale sidebar presence behind when switching to a different channel.
      // FIX-SW1: чистка выполняется ДО асинхронной проверки доступа — раньше
      // запрос к БД удерживал «след» в прежнем канале до секунды после
      // переключения.
      // FIX-GR2: присутствие при обрыве уже снято мгновенно (см. disconnect),
      // так что здесь: (1) гасим отложенный звук отключения, если человек
      // успел вернуться в тот же канал — вход станет «тихим» реконнектом;
      // (2) чистим живые дубли (переключение канала, вторая вкладка).
      let gracefulRejoin = false;
      const dropKey = `${authData.userId}:${channelId}`;
      const pendingDrop = pendingVoiceLeaves.get(dropKey);
      if (pendingDrop) {
        clearTimeout(pendingDrop.timer);
        pendingVoiceLeaves.delete(dropKey);
        gracefulRejoin = true;
      }
      for (const [oldChannelId, oldRoom] of Array.from(voiceRooms.entries())) {
        for (const [oldSocketId, oldUser] of Array.from(oldRoom.entries())) {
          if (oldUser.userId !== authData.userId) continue;
          if (oldChannelId === channelId && oldSocketId === socket.id) continue;

          // Замена сессии в том же канале — без звука: сразу следом придёт
          // user-joined того же человека.
          const silent = oldChannelId === channelId;

          oldRoom.delete(oldSocketId);
          const oldSocket = io.sockets.sockets.get(oldSocketId);
          oldSocket?.leave(`voice-${oldChannelId}`);
          io.to(`voice-${oldChannelId}`).emit("user-left", { socketId: oldSocketId, silent });

          if (oldSocketId !== socket.id) {
            oldSocket?.emit("voice-session-replaced", { channelId: oldChannelId });
          }
          if (oldRoom.size === 0) voiceRooms.delete(oldChannelId);
          void broadcastVoiceChannelUsers(oldChannelId);
          console.log(`[Voice] Removed stale presence ${oldSocketId} from channel ${oldChannelId}${silent ? " (silent replace)" : ""}`);
        }
      }

      if (!(await canAccessChannel(authData.userId, channelId))) {
        socket.emit("voice-join-denied", { channelId });
        return;
      }
      if (socket.data.voiceJoinSerial !== joinSerial) return;

      const user: VoiceUser = {
        socketId: socket.id,
        userId: authData.userId,
        userName: authData.userName,
        muted: false,
        avatar: authData.avatar,
      };

      if (!voiceRooms.has(channelId)) {
        voiceRooms.set(channelId, new Map());
      }
      const room = voiceRooms.get(channelId)!;

      const existingUsers = Array.from(room.values());
      socket.emit("voice-users", existingUsers);

      room.set(socket.id, user);
      socket.data.voiceChannelId = channelId;
      // FIX-COMMUNITY: отметка входа — для накопления времени в голосовых
      // (метрика раздела «Общественность», пишется при выходе).
      socket.data.voiceJoinedAt = Date.now();
      socket.join(`voice-${channelId}`);

      // FIX-GR1: флаг reconnected гасит звук подключения у собеседников,
      // когда это тихое возвращение после обрыва, а не новый вход.
      socket.to(`voice-${channelId}`).emit("user-joined", { ...user, reconnected: gracefulRejoin });

      /* SCREEN-LATEJOIN: рассказываем вошедшему о показах, которые уже идут.

         Раньше при входе отдавался только состав участников, и о трансляции
         вошедший не узнавал ничего: событие «показ начался» прошло до его
         прихода. Ведущий пробовал объявлять показ заново на каждого входящего,
         но делал это без списка допущенных — и приватный показ становился
         публичным. Состояние показов есть здесь, вместе с качеством и списком
         допущенных, поэтому объявлять правильнее с сервера.

         Приватный показ виден только тем, кто в списке: остальные, как и при
         обычном старте, не получают о нём даже события. */
      for (const [ownerSocketId, entry] of screenShareState) {
        if (entry.channelId !== channelId || ownerSocketId === socket.id) continue;
        if (entry.allow && !entry.allow.has(authData.userId)) continue;
        socket.emit("screen-share-started", {
          socketId: ownerSocketId,
          quality: entry.quality,
          private: !!entry.allow,
        });
      }

      // Explicit acknowledgement: a Socket.IO transport connection alone does
      // not mean the permission check passed or the voice room was joined.
      socket.emit("voice-joined", { channelId, userCount: room.size });

      // Broadcast updated user list for sidebar previews
      void broadcastVoiceChannelUsers(channelId);

      console.log(`[Voice] ${authData.userName} joined channel ${channelId}. Users: ${room.size}`);
    });

    socket.on("leave-voice", ({ channelId }: { channelId: string }, ack?: (result: { ok: true }) => void) => {
      // SCREEN-VIEWERS: см. обработчик disconnect — та же уборка при выходе.
      screenShareState.delete(socket.id);
      for (const [ownerSocketId, entry] of screenShareState) {
        if (entry.viewers.delete(socket.id)) broadcastScreenViewers(ownerSocketId);
      }
      leaveVoiceChannel(socket, channelId);
      if (typeof ack === "function") ack({ ok: true });
    });

    // Query who is in a voice channel (without joining) — group members only
    socket.on("get-voice-channel-users", async ({ channelId }: { channelId: string }) => {
      if (!(await canAccessChannel(authData.userId, channelId))) return;
      const room = voiceRooms.get(channelId);
      const users = room ? Array.from(room.values()) : [];
      socket.emit("voice-channel-users", { channelId, users });
    });

    // Query all voice channels at once — only channels in groups the
    // requesting user belongs to (was: leaked every private voice room).
    socket.on("get-all-voice-users", async () => {
      const memberships = await prisma.groupMember.findMany({
        where: { userId: authData.userId },
        select: { groupId: true },
      });
      const allowedGroups = new Set(memberships.map((m) => m.groupId));
      const result: Record<string, VoiceUser[]> = {};
      /* FIX-VOICEBADGE: списку сообществ нужна сводка «в каком сообществе сейчас
         кто-то говорит». Собираем её в том же проходе: группа канала уже
         посчитана, и второй круг запросов не нужен. Видно только свои сообщества —
         фильтр allowedGroups тот же. */
      const byGroup: Record<string, { count: number; channelIds: string[] }> = {};
      for (const [chId, room] of voiceRooms) {
        const groupId = await getChannelGroupId(chId);
        if (groupId && allowedGroups.has(groupId)) {
          const users = Array.from(room.values());
          result[chId] = users;
          if (users.length > 0) {
            const entry = byGroup[groupId] ?? { count: 0, channelIds: [] };
            entry.count += users.length;
            entry.channelIds.push(chId);
            byGroup[groupId] = entry;
          }
        }
      }
      socket.emit("all-voice-users", result);
      socket.emit("all-voice-groups", byGroup);
    });

    // WebRTC signaling: relay only between sockets that share a voice room.
    // Prevents shipping offers/ICE (and thus IP addresses) to arbitrary sockets.
    socket.on("voice-offer", ({ to, offer }: { to: string; offer: unknown }) => {
      if (socketFlood(socket, "voice-offer", 60, 10_000)) return;
      if (typeof to !== "string" || !sharedVoiceChannel(socket.id, to)) return;
      io.to(to).emit("voice-offer", { from: socket.id, offer });
    });

    socket.on("voice-answer", ({ to, answer }: { to: string; answer: unknown }) => {
      if (socketFlood(socket, "voice-answer", 60, 10_000)) return;
      if (typeof to !== "string" || !sharedVoiceChannel(socket.id, to)) return;
      io.to(to).emit("voice-answer", { from: socket.id, answer });
    });

    socket.on("ice-candidate", ({ to, candidate }: { to: string; candidate: unknown }) => {
      // ICE-кандидаты приходят пачками при trickle-негоциации — лимит щедрый.
      if (socketFlood(socket, "ice-candidate", 500, 10_000)) return;
      if (typeof to !== "string" || !sharedVoiceChannel(socket.id, to)) return;
      io.to(to).emit("ice-candidate", { from: socket.id, candidate });
    });

    // ── CALL: личный звонок один на один ────────────────────────
    //
    // Вызов уходит в комнату `dm-<userId>`, а не в один сокет: у человека
    // может быть телефон и компьютер одновременно, и звонить должны все
    // устройства, а трубку берёт одно — как у обычного телефона.

    /** Завершить вызов и разослать причину всем устройствам обоих участников. */
    function finishCall(call: CallSession, reason: string) {
      clearTimeout(call.timer);
      activeCalls.delete(call.callId);
      if (callByUser.get(call.callerId) === call.callId) callByUser.delete(call.callerId);
      if (callByUser.get(call.calleeId) === call.callId) callByUser.delete(call.calleeId);
      const payload = { callId: call.callId, reason };
      io.to(`dm-${call.callerId}`).emit("call-ended", payload);
      io.to(`dm-${call.calleeId}`).emit("call-ended", payload);
    }

    socket.on(
      "call-invite",
      async (
        { toUserId, video }: { toUserId: string; video?: boolean },
        ack?: (result: { ok: boolean; callId?: string; error?: string }) => void,
      ) => {
        const reply = (result: { ok: boolean; callId?: string; error?: string }) => {
          if (typeof ack === "function") ack(result);
        };
        /* Звонок будит чужой телефон, поэтому лимит жёстче любого другого
           события: без этого скрипт из десятка строк превращается в средство травли. */
        if (socketFlood(socket, "call-invite", 6, 60_000)) {
          reply({ ok: false, error: "Слишком много вызовов подряд" });
          return;
        }
        if (typeof toUserId !== "string" || !toUserId) {
          reply({ ok: false, error: "Неизвестный собеседник" });
          return;
        }

        const allowed = await canCall(authData.userId, toUserId);
        if (!allowed.ok) {
          reply({ ok: false, error: allowed.reason ?? "Звонок недоступен" });
          return;
        }

        /* Занято — у любой из сторон. Второй одновременный звонок означал бы два
           гудка в одних наушниках и два окна поверх блокировки. */
        if (callByUser.has(authData.userId)) {
          reply({ ok: false, error: "Вы уже в звонке" });
          return;
        }
        if (callByUser.has(toUserId)) {
          reply({ ok: false, error: "Абонент занят" });
          return;
        }

        const callId = randomUUID();
        const wantsVideo = video === true;
        const call: CallSession = {
          callId,
          callerId: authData.userId,
          calleeId: toUserId,
          callerName: authData.userName,
          callerSocketId: socket.id,
          calleeSocketId: null,
          video: wantsVideo,
          expiresAt: Date.now() + CALL_RING_MS,
          state: "ringing",
          /* Автоотмена. Без неё забытый вызов висит вечно и держит обоих в
             состоянии «занято» — больше никто им не дозвонится. */
          timer: setTimeout(() => {
            const pending = activeCalls.get(callId);
            if (!pending || pending.state !== "ringing") return;
            finishCall(pending, "timeout");
            /* Пропущенный вызов остаётся в колокольчике: иначе о звонке в два ночи
               человек узнает только от звонившего. */
            void createNotification({
              userId: pending.calleeId,
              type: "CALL_MISSED",
              title: "Пропущенный вызов",
              body: pending.callerName,
              link: "/connect?section=dm",
              actorId: pending.callerId,
            }).catch(() => null);
          }, CALL_RING_MS),
        };

        activeCalls.set(callId, call);
        callByUser.set(call.callerId, callId);
        callByUser.set(call.calleeId, callId);

        io.to(`dm-${toUserId}`).emit("call-incoming", {
          callId,
          from: {
            userId: authData.userId,
            userName: authData.userName,
            avatar: authData.avatar ?? null,
          },
          video: wantsVideo,
          expiresAt: call.expiresAt,
        });

        /* Закрытое приложение сокета не держит — без доставки телефон в кармане
           просто молчит, и вся затея со звонком теряет смысл. */
        queuePush([toUserId], {
          title: authData.userName,
          body: wantsVideo ? "Видеовызов" : "Вам звонят",
          link: `/connect?call=${callId}`,
          tag: `call-${callId}`,
          call: {
            callId,
            callerName: authData.userName,
            callerAvatar: authData.avatar ?? undefined,
            video: wantsVideo,
            ttlSeconds: Math.round(CALL_RING_MS / 1000),
          },
        });

        reply({ ok: true, callId });
        console.log(`[Call] ${authData.userName} → ${toUserId} (${wantsVideo ? "video" : "audio"}) ${callId}`);
      },
    );

    socket.on("call-accept", ({ callId }: { callId: string }) => {
      const call = activeCalls.get(callId);
      if (!call || call.calleeId !== authData.userId) return;
      if (call.state === "active") {
        /* Трубку уже взяли на другом устройстве. */
        socket.emit("call-taken", { callId });
        return;
      }
      clearTimeout(call.timer);
      call.state = "active";
      call.calleeSocketId = socket.id;
      /* Звонок принят одним устройством — остальные обязаны перестать звенеть. */
      socket.to(`dm-${call.calleeId}`).emit("call-taken", { callId });
      io.to(call.callerSocketId).emit("call-accepted", { callId, peerSocketId: socket.id });
      socket.emit("call-accepted", { callId, peerSocketId: call.callerSocketId });
    });

    socket.on("call-decline", ({ callId }: { callId: string }) => {
      const call = activeCalls.get(callId);
      if (!call || call.calleeId !== authData.userId) return;
      finishCall(call, "declined");
    });

    socket.on("call-hangup", ({ callId }: { callId: string }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      if (call.callerId !== authData.userId && call.calleeId !== authData.userId) return;
      /* До ответа это отмена вызова, после — обычное завершение разговора.
         Разница важна только для подписи на экране. */
      finishCall(call, call.state === "ringing" ? "cancelled" : "hangup");
    });

    /**
     * Медиа-договорённость внутри звонка.
     *
     * Передаётся ТОЛЬКО между двумя сокетами именно этого звонка. Голосовые
     * события (voice-offer и т.д.) тут не годятся: они требуют общей голосовой
     * комнаты, а у звонка комнаты нет. Отсюда же следует главное правило:
     * без проверки участия в звонке через релей утекает адрес сети человека:
     * ICE-кандидаты содержат его IP.
     */
    socket.on(
      "call-signal",
      ({ callId, kind, payload }: { callId: string; kind: string; payload: unknown }) => {
        if (socketFlood(socket, "call-signal", 500, 10_000)) return;
        if (!callSignalKinds(kind)) return;
        const call = activeCalls.get(callId);
        if (!call) return;
        const isCaller = call.callerSocketId === socket.id;
        const isCallee = call.calleeSocketId === socket.id;
        if (!isCaller && !isCallee) return;
        const target = isCaller ? call.calleeSocketId : call.callerSocketId;
        if (!target) return;
        io.to(target).emit("call-signal", { callId, kind, payload });
      },
    );

    /** Состояние микрофона и камеры — чтобы вторая сторона видела подпись, а не чёрный квадрат. */
    socket.on(
      "call-media",
      ({ callId, muted, video }: { callId: string; muted?: boolean; video?: boolean }) => {
        if (socketFlood(socket, "call-media", 60, 10_000)) return;
        const call = activeCalls.get(callId);
        if (!call) return;
        const isCaller = call.callerSocketId === socket.id;
        const isCallee = call.calleeSocketId === socket.id;
        if (!isCaller && !isCallee) return;
        const target = isCaller ? call.calleeSocketId : call.callerSocketId;
        if (!target) return;
        io.to(target).emit("call-media", { callId, muted: muted === true, video: video === true });
      },
    );

    socket.on("toggle-mute", ({ channelId, muted }: { channelId: string; muted: boolean }) => {
      const room = voiceRooms.get(channelId);
      if (room) {
        const user = room.get(socket.id);
        if (user) {
          // FIX-VALID: приводим к boolean — не доверяем произвольному значению
          // из полезной нагрузки клиента.
          const isMuted = muted === true;
          user.muted = isMuted;
          socket.to(`voice-${channelId}`).emit("user-muted", { socketId: socket.id, muted: isMuted });
        }
      }
    });

    socket.on("speaking", ({ channelId, speaking }: { channelId: string; speaking: boolean }) => {
      if (socketFlood(socket, "speaking", 80, 10_000)) return;
      if (!voiceRooms.get(channelId)?.has(socket.id)) return;
      socket.to(`voice-${channelId}`).emit("user-speaking", { socketId: socket.id, speaking: speaking === true });
    });

    socket.on("screen-share-started", ({ channelId, quality, allowUserIds }: { channelId: string; quality?: { resolution?: number; fps?: number }; allowUserIds?: unknown }) => {
      const room = voiceRooms.get(channelId);
      if (!room?.has(socket.id)) return;
      // Relay the actual selected quality instead of making viewers assume a
      // hard-coded 1080p/30. Values are constrained to the supported presets.
      const safeQuality = {
        resolution: quality?.resolution === 1080 ? 1080 : 720,
        fps: quality?.fps === 60 ? 60 : 30,
      };

      // SCREEN-PRIVATE: приватная трансляция — список userId, которым она видна.
      // Пустой/отсутствующий список = публичный показ (прежнее поведение).
      const allow = Array.isArray(allowUserIds)
        ? new Set(allowUserIds.filter((v): v is string => typeof v === "string").slice(0, 200))
        : null;
      const entry = {
        channelId,
        allow,
        quality: safeQuality,
        viewers: new Map<string, { userId: string; userName: string }>(),
      };
      screenShareState.set(socket.id, entry);

      if (!allow) {
        socket.to(`voice-${channelId}`).emit("screen-share-started", { socketId: socket.id, quality: safeQuality, private: false });
        return;
      }
      // Приватный показ: событие уходит ТОЛЬКО разрешённым — остальные о нём
      // не узнают (и трек им не отправляет сам ведущий, см. VoiceContext).
      for (const [sid, user] of room) {
        if (sid === socket.id || !allow.has(user.userId)) continue;
        io.to(sid).emit("screen-share-started", { socketId: socket.id, quality: safeQuality, private: true });
      }
    });

    /* SCREEN-PRIVATE-LIVE: ведущий меняет состав допущенных, не прерывая показ.
       Тем, кто получил доступ, объявляем показ как только что начатый; тем, кто
       его лишился, отправляем «показ остановлен» — для них он действительно
       закончился (дорожку снимает сам ведущий, см. VoiceContext) — и убираем их
       из списка зрителей. */
    socket.on("screen-share-allow-update", ({ channelId, allowUserIds }: { channelId: string; allowUserIds?: unknown }) => {
      if (socketFlood(socket, "screen-allow", 30, 10_000)) return;
      const room = voiceRooms.get(channelId);
      const entry = screenShareState.get(socket.id);
      if (!room?.has(socket.id) || !entry || entry.channelId !== channelId) return;

      const parsed = Array.isArray(allowUserIds)
        ? new Set(allowUserIds.filter((v): v is string => typeof v === "string").slice(0, 200))
        : null;
      const previous = entry.allow;
      entry.allow = parsed && parsed.size > 0 ? parsed : null;

      const allowedBefore = (userId: string) => !previous || previous.has(userId);
      const allowedNow = (userId: string) => !entry.allow || entry.allow.has(userId);

      let viewersChanged = false;
      for (const [sid, user] of room) {
        if (sid === socket.id) continue;
        const before = allowedBefore(user.userId);
        const now = allowedNow(user.userId);
        if (before === now) continue;
        if (now) {
          io.to(sid).emit("screen-share-started", {
            socketId: socket.id,
            quality: entry.quality,
            private: !!entry.allow,
          });
        } else {
          io.to(sid).emit("screen-share-stopped", { socketId: socket.id });
          if (entry.viewers.delete(sid)) viewersChanged = true;
        }
      }
      if (viewersChanged) broadcastScreenViewers(socket.id);
    });

    socket.on("screen-share-stopped", ({ channelId }: { channelId: string }) => {
      if (!voiceRooms.get(channelId)?.has(socket.id)) return;
      screenShareState.delete(socket.id);
      socket.to(`voice-${channelId}`).emit("screen-share-stopped", { socketId: socket.id });
    });

    // SCREEN-VIEWERS: кто сейчас смотрит трансляцию. Зритель сообщает об
    // открытии/закрытии окна показа, сервер сверяет комнату и приватный список
    // и рассылает актуальный состав зрителей ведущему и самим зрителям.
    socket.on("screen-view-start", ({ channelId, ownerSocketId }: { channelId: string; ownerSocketId: string }) => {
      if (socketFlood(socket, "screen-view", 40, 10_000)) return;
      const room = voiceRooms.get(channelId);
      const me = room?.get(socket.id);
      const entry = screenShareState.get(ownerSocketId);
      if (!me || !entry || entry.channelId !== channelId) return;
      if (entry.allow && !entry.allow.has(me.userId)) return; // нет доступа — не зритель
      entry.viewers.set(socket.id, { userId: me.userId, userName: me.userName });
      broadcastScreenViewers(ownerSocketId);
    });

    socket.on("screen-view-stop", ({ ownerSocketId }: { ownerSocketId: string }) => {
      const entry = screenShareState.get(ownerSocketId);
      if (!entry?.viewers.delete(socket.id)) return;
      broadcastScreenViewers(ownerSocketId);
    });

    // FIX-CAM: ретрансляция событий камеры. streamId нужен получателям, чтобы
    // отличить видеодорожку камеры от дорожки демонстрации экрана.
    socket.on("camera-started", ({ channelId, streamId }: { channelId: string; streamId?: string }) => {
      if (!voiceRooms.get(channelId)?.has(socket.id)) return;
      if (typeof streamId !== "string" || !streamId) return;
      socket.to(`voice-${channelId}`).emit("camera-started", { socketId: socket.id, streamId });
    });

    socket.on("camera-stopped", ({ channelId }: { channelId: string }) => {
      if (!voiceRooms.get(channelId)?.has(socket.id)) return;
      socket.to(`voice-${channelId}`).emit("camera-stopped", { socketId: socket.id });
    });

    // ── Disconnect ──────────────────────────────────────────────────
    socket.on("disconnect", () => {
      console.log(`[Socket] Disconnected: ${socket.id}`);

      // SCREEN-VIEWERS: снимаем свою трансляцию и вычёркиваем себя из зрителей
      // чужих — иначе состав зрителей «зависал» бы после разрыва связи.
      screenShareState.delete(socket.id);
      for (const [ownerSocketId, entry] of screenShareState) {
        if (entry.viewers.delete(socket.id)) broadcastScreenViewers(ownerSocketId);
      }

      // Clean up user socket tracking
      if (authData) {
        const sockets = userSockets.get(authData.userId);
        if (sockets) {
          sockets.delete(socket.id);
          if (sockets.size === 0) userSockets.delete(authData.userId);
        }
      }

      authenticatedSockets.delete(socket.id);

      /* CALL: у звонка нет grace-окна, как у голосового канала. Пропавшая связь
         во время разговора — это конец разговора: медиа-соединение всё равно рвётся,
         и держать после этого второго человека в состоянии «занято» бессмысленно. */
      if (authData) {
        const stillOnline = (userSockets.get(authData.userId)?.size ?? 0) > 0;
        const ownCallId = callByUser.get(authData.userId);
        const ownCall = ownCallId ? activeCalls.get(ownCallId) : undefined;
        if (ownCall) {
          const wasParticipant =
            ownCall.callerSocketId === socket.id || ownCall.calleeSocketId === socket.id;
          /* Звонящий закрыл вкладку — вызов снимаем сразу. А вот у того, кому
             звонят, отвалившееся устройство не обязано гасить вызов: трубку могут
             взять на втором, где вызов ещё звонит. */
          if (wasParticipant || !stillOnline) {
            finishCall(ownCall, ownCall.state === "ringing" ? "unavailable" : "hangup");
          }
        }
      }

      const channelsToLeave = Array.from(voiceRooms.entries())
        .filter(([, room]) => room.has(socket.id))
        .map(([channelId]) => channelId);
      for (const channelId of channelsToLeave) {
        // FIX-GR2: обрыв транспорта. Присутствие снимаем СРАЗУ — сайдбар и
        // список участников не должны показывать «иллюзию присутствия».
        // Grace-окно теперь только про звуки: user-left уходит с silent, а
        // звук отключения (voice-user-dropped) собеседники слышат лишь если
        // человек не вернулся за VOICE_LEAVE_GRACE_MS. Вернулся — join-voice
        // снимет таймер и вход будет тихим (reconnected).
        const user = voiceRooms.get(channelId)?.get(socket.id);
        if (!user) continue;
        const graceKey = `${user.userId}:${channelId}`;
        const prev = pendingVoiceLeaves.get(graceKey);
        if (prev) clearTimeout(prev.timer);
        leaveVoiceChannel(socket, channelId, { silent: true });
        const timer = setTimeout(() => {
          pendingVoiceLeaves.delete(graceKey);
          io.to(`voice-${channelId}`).emit("voice-user-dropped", { userId: user.userId, userName: user.userName });
        }, VOICE_LEAVE_GRACE_MS);
        pendingVoiceLeaves.set(graceKey, { timer, socketId: socket.id });
        console.log(`[Voice] ${user.userName} lost transport — removed from ${channelId} immediately, drop sound in ${VOICE_LEAVE_GRACE_MS}ms unless rejoin`);
      }
    });

    function leaveVoiceChannel(sock: typeof socket, channelId: string, opts?: { silent?: boolean }) {
      const room = voiceRooms.get(channelId);
      if (room) {
        const user = room.get(sock.id);
        // FIX-GR1: явный выход отменяет возможный grace-таймер этой записи,
        // чтобы после него не прилетел второй (запоздалый) user-left.
        if (user) {
          const graceKey = `${user.userId}:${channelId}`;
          const pending = pendingVoiceLeaves.get(graceKey);
          if (pending && pending.socketId === sock.id) {
            clearTimeout(pending.timer);
            pendingVoiceLeaves.delete(graceKey);
          }
        }
        room.delete(sock.id);
        sock.leave(`voice-${channelId}`);
        if (sock.data.voiceChannelId === channelId) sock.data.voiceChannelId = undefined;

        // FIX-COMMUNITY: накапливаем проведённое в голосовом время в
        // GroupMember.voiceSeconds — метрика раздела «Общественность».
        // Ошибка записи (например, участника уже нет в группе) не должна
        // ломать штатный выход из канала.
        const joinedAt = Number(sock.data.voiceJoinedAt ?? 0);
        sock.data.voiceJoinedAt = undefined;
        if (user && joinedAt > 0) {
          const seconds = Math.floor((Date.now() - joinedAt) / 1000);
          if (seconds > 0) {
            void (async () => {
              try {
                const groupId = await getChannelGroupId(channelId);
                if (groupId) {
                  await prisma.groupMember.update({
                    where: { userId_groupId: { userId: user.userId, groupId } },
                    data: { voiceSeconds: { increment: seconds } },
                  });
                }
              } catch { /* не участник группы / канал удалён — пропускаем */ }
            })();
          }
        }
        // During disconnect Socket.IO may already have cleared sock.rooms.
        // Address the room from io so the remaining clients are always updated.
        io.to(`voice-${channelId}`).emit("user-left", { socketId: sock.id, silent: opts?.silent });

        if (room.size === 0) {
          voiceRooms.delete(channelId);
        }

        // Broadcast updated user list for sidebar previews
        void broadcastVoiceChannelUsers(channelId);

        if (user) {
          console.log(`[Voice] ${user.userName} left channel ${channelId}. Users: ${room.size}`);
        }
      }
    }
  });

  // Connect Redis for rate limiting (fallback to in-memory if unavailable)
  connectRedis().then((ok) => {
    if (ok) console.log("[Redis] Connected successfully");
  });

  /* Автоочистка вложений отозвана.

     Задача удаляла с диска файлы старше 14 дней крупнее 1 МБ, а в переписке на
     их месте оставалась подпись «изображение удалено для оптимизации
     хранилища». Экономия места обошлась дороже, чем стоила: человек открывает
     свою же переписку и видит, что вложения нет, — хотя ничего не удалял.
     Сообщение на месте, ссылка на месте, файла нет.

     Вложения теперь живут столько же, сколько сообщение, к которому приложены,
     и исчезают только вместе с ним. */

  /* Срок подписки Premium: раз в шесть часов снимаем премиум там, где
     оплаченный срок вышел. Без этой задачи `expiresAt` был украшением —
     подписка «на месяц» работала бессрочно. */
  const PREMIUM_EXPIRY_INTERVAL = 6 * 60 * 60 * 1000;
  const runPremiumExpiry = async () => {
    // FIX-DIST: срок подписок пересчитывает один инстанс за тик.
    if (!(await acquireTaskLock("trioz:lock:premium-expiry", 5 * 60_000))) return;
    try {
      const { expireOverduePremium } = await import("./src/lib/premiumExpiry");
      const result = await expireOverduePremium();
      if (result.subscriptionsExpired > 0 || result.usersDowngraded > 0) {
        console.log("[Premium] Срок вышел:", result);
      }
    } catch (err) {
      console.error("[Premium] Ошибка проверки срока подписок:", err);
    }
  };
  setInterval(runPremiumExpiry, PREMIUM_EXPIRY_INTERVAL);
  setTimeout(runPremiumExpiry, 60_000);

  /* VPN-PLAN: то же самое для подписки «только VPN». Отдельная задача, а не
     ветка внутри предыдущей: у подписок свои таблицы и своё событие для
     клиента, и падение одной проверки не должно срывать другую. */
  const runVpnExpiry = async () => {
    if (!(await acquireTaskLock("trioz:lock:vpn-expiry", 5 * 60_000))) return;
    try {
      const { expireOverdueVpn } = await import("./src/lib/vpnExpiry");
      const result = await expireOverdueVpn();
      if (result.subscriptionsExpired > 0 || result.usersRevoked > 0) {
        console.log("[VPN] Срок вышел:", result);
      }
    } catch (err) {
      console.error("[VPN] Ошибка проверки срока подписок:", err);
    }
  };
  setInterval(runVpnExpiry, PREMIUM_EXPIRY_INTERVAL);
  setTimeout(runVpnExpiry, 90_000);

  /**
   * REMIND: напоминания на карточках рабочей среды — раз в полминуты.
   *
   * Карточка сработать не может: это кусок JSON внутри состояния среды, и пока
   * холст закрыт, его никто не читает. Поэтому время продублировано отдельной
   * строкой (см. CardReminder), а находит наступившие сроки сервер — тем же
   * способом, что и отложенные сообщения рядом.
   *
   * Строка сначала помечается сработавшей и только потом рассылается. Порядок
   * важен: упади рассылка — человек не получит одно напоминание, а при обратном
   * порядке он получал бы его каждые полминуты, пока не починят.
   */
  setInterval(async () => {
    // FIX-DIST: наступившие напоминания разбирает ровно один инстанс.
    if (!(await acquireTaskLock("trioz:lock:card-reminders", 25_000))) return;
    try {
      const due = await prisma.cardReminder.findMany({
        where: { firedAt: null, remindAt: { lte: new Date() } },
        take: 50,
      });
      if (due.length === 0) return;

      const { createNotification } = await import("./src/lib/createNotification");
      for (const reminder of due) {
        /* Заявка на рассылку: если строку уже забрал другой процесс, count = 0
           и второго уведомления не будет. */
        const claimed = await prisma.cardReminder.updateMany({
          where: { id: reminder.id, firedAt: null },
          data: { firedAt: new Date() },
        });
        if (claimed.count !== 1) continue;

        try {
          await createNotification({
            userId: reminder.userId,
            type: "system",
            title: "Напоминание",
            body: reminder.title,
            link: reminder.link,
            entityType: "card_reminder",
            entityId: reminder.cardId,
          });
        } catch (err) {
          console.error("[reminders] не удалось уведомить:", err);
        }
      }
    } catch (err) {
      console.error("[reminders] обход не удался:", err);
    }
  }, 30_000);

  // Scheduled message sender: every 30 seconds
  setInterval(async () => {
    // FIX-DIST: due-сообщения обрабатывает ровно один инстанс. TTL лока (25с)
    // меньше интервала (30с), поэтому к следующему тику он сам истекает.
    if (!(await acquireTaskLock("trioz:lock:scheduled-msgs", 25_000))) return;
    try {
      const due = await prisma.scheduledMessage.findMany({
        where: { sent: false, scheduledAt: { lte: new Date() } },
        take: 20,
      });
      for (const sm of due) {
        // Create the real message with the same shape the /api/messages route
        // returns, so clients render it identically (and key it by its own id).
        const message = await prisma.message.create({
          data: { content: sm.content, channelId: sm.channelId, userId: sm.userId },
          include: {
            user: { select: { id: true, name: true, username: true, avatar: true, role: true, avatarGlowEnabled: true, avatarGlowColors: true, profileBanner: true, lastSeen: true } },
            reactions: { select: { id: true, emoji: true, userId: true, user: { select: { id: true, name: true } } } },
            replyTo: { select: { id: true, content: true, user: { select: { id: true, name: true } } } },
            reads: { select: { userId: true } },
            _count: { select: { threadReplies: true } },
          },
        });
        await prisma.scheduledMessage.update({ where: { id: sm.id }, data: { sent: true } });
        // Clients join `channel-<id>` (see socketEmit.ts and the join-channel
        // handler above), so the event must target that exact room name.
        io.to(`channel-${sm.channelId}`).emit("new-message", message);
      }
    } catch (err) {
      console.error("[Scheduled] Error:", err);
    }
  }, 30_000);

  /**
   * NEWSPOST: отложенные публикации в ленте новостей — раз в полминуты.
   *
   * Пост с назначенным временем до этого момента виден только автору. Наступил
   * срок — о нём нужно рассказать: без этого обхода отложенная публикация
   * означала бы «пост тихо появится в ленте, и заметит его тот, кто случайно
   * зайдёт», а весь смысл был в обратном.
   *
   * Отметку announcedAt ставит сама рассылка (announceNewsPost) и ставит её ДО
   * отправки, условием `announcedAt: null` — то есть заявкой, которую выигрывает
   * ровно один процесс. Упади отправка — люди не получат одно уведомление; при
   * обратном порядке они получали бы его каждые полминуты, пока не починят.
   *
   * Черновики сюда не попадают по условию выборки: у черновика тоже может быть
   * назначено время, но публиковать его никто не просил.
   */
  setInterval(async () => {
    // FIX-DIST: наступившие публикации разбирает ровно один инстанс.
    if (!(await acquireTaskLock("trioz:lock:news-posts", 25_000))) return;
    try {
      const due = await prisma.message.findMany({
        where: {
          draft: false,
          announcedAt: null,
          publishAt: { lte: new Date() },
          // Комментарий (threadId заполнен) постом не является.
          threadId: null,
        },
        select: { id: true },
        take: 50,
      });
      if (due.length === 0) return;

      const { announceNewsPost } = await import("./src/lib/newsPost");
      for (const post of due) {
        try {
          await announceNewsPost(post.id);
        } catch (err) {
          console.error("[news] не удалось уведомить о посте:", err);
        }
      }
    } catch (err) {
      console.error("[news] обход отложенных публикаций не удался:", err);
    }
  }, 30_000);

  // FIX-CAL-REMIND: напоминания о событиях календаря, на которые подписан
  // пользователь (кнопка-колокольчик в модуле «Календарь»). Раз в минуту один
  // инстанс (Redis-лок) находит подписки на события, начинающиеся в ближайшие
  // 15 минут, и шлёт личное уведомление — в колокольчик/страницу уведомлений,
  // тем же socket-событием, что и createNotification. remindedAt исключает
  // повторную отправку.
  const REMIND_AHEAD_MS = 15 * 60 * 1000;
  setInterval(async () => {
    if (!(await acquireTaskLock("trioz:lock:event-reminders", 55_000))) return;
    try {
      const now = new Date();
      const horizon = new Date(now.getTime() + REMIND_AHEAD_MS);
      const due = await prisma.calendarEventSubscription.findMany({
        where: { remindedAt: null, event: { start: { gte: now, lte: horizon } } },
        include: { event: { select: { id: true, title: true, start: true } } },
        take: 200,
      });
      if (due.length === 0) return;

      // Группируем подписки по событию: у каждого события одинаковые title/start,
      // поэтому все подписчики одного события получают идентичное уведомление —
      // это даёт одну выборку настроек + одну вставку на событие вместо двух запросов на каждого подписчика.
      const byEvent = new Map<string, typeof due>();
      for (const sub of due) {
        const group = byEvent.get(sub.event.id) ?? [];
        group.push(sub);
        byEvent.set(sub.event.id, group);
      }

      const sentIds: string[] = [];
      for (const subs of byEvent.values()) {
        try {
          const startsAt = new Date(subs[0].event.start);
          const minutesLeft = Math.max(1, Math.round((startsAt.getTime() - Date.now()) / 60_000));
          const when = startsAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
          // Настройки и вставка пакетом: цикл давал по два запроса на каждого подписчика
          await createNotificationsBulk({
            userIds: subs.map((s) => s.userId),
            type: "calendar",
            title: `Скоро событие: ${subs[0].event.title}`,
            body: `Начало в ${when} — через ~${minutesLeft} мин`,
            link: "/settings/notifications",
          });
          for (const s of subs) sentIds.push(s.id);
        } catch (err) {
          console.error("[CalRemind] send error:", err);
        }
      }

      // Отметка об отправке одним запросом вместо update в цикле
      if (sentIds.length > 0) {
        await prisma.calendarEventSubscription.updateMany({
          where: { id: { in: sentIds } },
          data: { remindedAt: new Date() },
        });
      }
    } catch (err) {
      console.error("[CalRemind] Error:", err);
    }
  }, 60_000);

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
