import { lookup } from "dns/promises";
import { decrypt, encrypt, isEncrypted } from "@/lib/encryption";
import { sanitizeText } from "@/lib/sanitize";

/**
 * GAMES-CATALOG: работа с каталогом игр и связкой партнёрских игр по API.
 *
 * Контракт для разработчика-партнёра сознательно сведён к ОДНОЙ точке. Чем
 * больше эндпойнтов мы требуем, тем больше шансов, что интеграция не заработает
 * из-за половинчатой реализации на чужой стороне:
 *
 *   GET {apiBaseUrl}/trioz/manifest
 *   Authorization: Bearer <ключ, который выдал разработчик>
 *
 *   200 OK
 *   {
 *     "title":       "Название игры",
 *     "description": "Описание для карточки",
 *     "cover":       "https://.../cover.jpg",
 *     "players":     "2-8 игроков",
 *     "tags":        ["Стратегия", "PvP"],
 *     "launchUrl":   "https://play.example.com/trioz",
 *     "partner":     "Название студии",
 *     "online":      137
 *   }
 *
 * Этот же запрос используется как проверка связи: отдельного health-эндпойнта
 * нет. Успешный манифест = игра на связи, ошибка = `linkState = ERROR` с
 * текстом причины в панели.
 */

export const PARTNER_MANIFEST_PATH = "/trioz/manifest";
const FETCH_TIMEOUT_MS = 8000;
/** Манифест — это текст, а не выгрузка. Больше 64 КБ читать незачем. */
const MAX_MANIFEST_BYTES = 64 * 1024;

export interface PartnerManifest {
  title: string;
  description: string;
  cover: string;
  players: string;
  tags: string;
  launchUrl: string;
  partnerName: string;
  online: number | null;
}

/* ── Адрес партнёрского API ───────────────────────────────────────────── */

/**
 * Хост из приватного диапазона — признак того, что запрос уйдёт не наружу, а
 * внутрь нашей же инфраструктуры. Адрес здесь вводит администратор, то есть
 * доверенное лицо, но опечатка вида `http://localhost:5432` не должна
 * превращать сервер в инструмент для стука по внутренним портам.
 */
function isPrivateAddress(address: string): boolean {
  if (address.includes(":")) {
    const v6 = address.toLowerCase();
    // ::1, fc00::/7 (unique local), fe80::/10 (link-local)
    return v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") ||
      v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb");
  }
  const p = address.split(".").map((n) => parseInt(n, 10));
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local, в облаках — метаданные
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/** Нормализует адрес партнёрского API или объясняет, что с ним не так. */
export function normalizeApiBaseUrl(raw: unknown): { url: string } | { error: string } {
  if (typeof raw !== "string" || !raw.trim()) return { error: "Укажите адрес API разработчика" };
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { error: "Адрес API не похож на ссылку — нужен вид https://api.example.com" };
  }
  if (parsed.protocol !== "https:") {
    // Ключ уходит в заголовке Authorization: по http он поедет открытым текстом.
    return { error: "Только https: по http ключ разработчика уйдёт открытым текстом" };
  }
  if (parsed.username || parsed.password) {
    return { error: "Логин и пароль в адресе не нужны — ключ передаётся заголовком" };
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    return { error: "Внутренние адреса недопустимы — нужен публичный домен разработчика" };
  }
  return { url: `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}` };
}

/** Проверяет, что домен разрешается в публичный адрес. */
async function assertPublicHost(url: string): Promise<string | null> {
  const host = new URL(url).hostname;
  try {
    const records = await lookup(host, { all: true });
    if (!records.length) return "Домен разработчика не разрешается в адрес";
    if (records.some((r) => isPrivateAddress(r.address))) {
      return "Домен разработчика ведёт во внутреннюю сеть — так интеграция работать не будет";
    }
    return null;
  } catch {
    return "Домен разработчика не найден в DNS";
  }
}

/* ── Манифест ─────────────────────────────────────────────────────────── */

function readString(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return sanitizeText(value).trim().slice(0, max);
}

/** Обложка и ссылка запуска приходят от партнёра, поэтому только https. */
function readHttpsUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" ? u.toString().slice(0, 500) : "";
  } catch {
    return "";
  }
}

function readTags(value: unknown): string {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return list
    .map((t) => (typeof t === "string" ? sanitizeText(t).trim() : ""))
    .filter(Boolean)
    .slice(0, 8)
    .join(", ")
    .slice(0, 200);
}

/**
 * Забирает манифест у партнёра. Ошибку возвращает текстом, а не исключением:
 * этот текст показывается администратору в панели, поэтому он должен быть
 * человеческим — «нет ответа за 8 секунд» полезнее, чем «fetch failed».
 */
export async function fetchPartnerManifest(
  apiBaseUrl: string,
  apiKey: string,
): Promise<{ manifest: PartnerManifest } | { error: string }> {
  const hostProblem = await assertPublicHost(apiBaseUrl);
  if (hostProblem) return { error: hostProblem };

  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl}${PARTNER_MANIFEST_PATH}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "User-Agent": "TrioZ-Games/1.0",
      },
      // Редиректы отключены намеренно: 302 на внутренний адрес — классический
      // способ обойти проверку хоста, которую мы сделали выше.
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    const aborted = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { error: aborted ? "API разработчика не ответил за 8 секунд" : "Не удалось соединиться с API разработчика" };
  }

  if (res.status >= 300 && res.status < 400) {
    return { error: "API отвечает редиректом — укажите конечный адрес манифеста" };
  }
  if (res.status === 401 || res.status === 403) {
    return { error: "Ключ отклонён разработчиком (401/403) — проверьте ключ" };
  }
  if (res.status === 404) {
    return { error: `Разработчик не отдаёт ${PARTNER_MANIFEST_PATH} — этот путь обязателен` };
  }
  if (!res.ok) {
    return { error: `API разработчика ответил ${res.status}` };
  }

  const raw = await res.text().catch(() => "");
  if (!raw) return { error: "API вернул пустой ответ" };
  if (raw.length > MAX_MANIFEST_BYTES) return { error: "Манифест слишком большой" };

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { error: "Ответ не является JSON" };
  }
  if (!data || typeof data !== "object") return { error: "Манифест должен быть объектом JSON" };
  const obj = data as Record<string, unknown>;

  const title = readString(obj.title, 120);
  if (!title) return { error: "В манифесте нет обязательного поля title" };
  const launchUrl = readHttpsUrl(obj.launchUrl);
  if (!launchUrl) return { error: "В манифесте нет обязательного поля launchUrl (https)" };

  const online = typeof obj.online === "number" && Number.isFinite(obj.online)
    ? Math.max(0, Math.min(10_000_000, Math.round(obj.online)))
    : null;

  return {
    manifest: {
      title,
      description: readString(obj.description, 1000),
      cover: readHttpsUrl(obj.cover),
      players: readString(obj.players, 60),
      tags: readTags(obj.tags),
      launchUrl,
      partnerName: readString(obj.partner ?? obj.partnerName, 120),
      online,
    },
  };
}

/* ── Ключ разработчика ────────────────────────────────────────────────── */

/** Ключ в базе лежит зашифрованным; в открытом виде он живёт только в памяти. */
export function storeApiKey(plain: string): string {
  return encrypt(plain);
}

export function readApiKey(stored: string | null): string {
  if (!stored) return "";
  try {
    return isEncrypted(stored) ? decrypt(stored) : stored;
  } catch {
    // Сменился ENCRYPTION_SECRET — ключ восстановить нельзя, его нужно ввести
    // заново. Возвращаем пустую строку, чтобы связка честно упала с 401.
    return "";
  }
}

/**
 * Что показываем администратору вместо ключа. Полный ключ не возвращается ни
 * одним маршрутом: он нужен только серверу для исходящего запроса, а на экране
 * от него польза лишь одна — понять, тот ли ключ вставлен.
 */
export function apiKeyPreview(stored: string | null): string {
  const plain = readApiKey(stored);
  if (!plain) return "";
  return `••••${plain.slice(-4)}`;
}

/* ── Представление для клиента ────────────────────────────────────────── */

export function parseTags(tags: string): string[] {
  return tags.split(",").map((t) => t.trim()).filter(Boolean);
}

export const GAME_KINDS = ["OWN", "PARTNER"] as const;
export type GameKind = (typeof GAME_KINDS)[number];

export function isGameKind(value: unknown): value is GameKind {
  return value === "OWN" || value === "PARTNER";
}

/** Ссылка карточки: у своих игр — внутренний путь, у партнёрских — их адрес. */
export function gameHref(entry: { kind: string; slug: string; launchUrl: string }): string {
  if (entry.launchUrl) return entry.launchUrl;
  return entry.kind === "OWN" ? `/games/${entry.slug}` : "";
}
