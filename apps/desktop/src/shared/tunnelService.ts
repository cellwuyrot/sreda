/**
 * SERVICE-TUNNEL: канал связи приложения со ПОСТОЯННЫМ служебным компонентом.
 *
 * Зачем он появился. Сетевое устройство в Windows создаёт драйвер Wintun, а это
 * работа уровня ядра: без прав SYSTEM адаптера не будет — ни у нас, ни у
 * WireGuard, ни у кого-либо ещё. До этой правки права запрашивались КАЖДЫЙ раз
 * при нажатии кнопки: окно UAC, отказ — и «включено, но не работает».
 *
 * Как теперь. Один раз, во время установки программы (установщик и так идёт с
 * правами), регистрируется наш собственный служебный компонент, который работает
 * от SYSTEM и живёт всё время. Приложение под обычным пользователем НЕ повышает
 * права вообще: оно кладёт в общий каталог файл-заявку, компонент её выполняет и
 * возвращает результат тем же способом. Никаких сторонних служб и приложений в
 * этой схеме нет — только наш код.
 *
 * Почему обмен файлами, а не именованный канал. Канал, созданный процессом
 * SYSTEM, по умолчанию закрыт для обычного пользователя, а выставить ему ACL из
 * Node нельзя. Каталог же открывается один раз при установке (`icacls`), и
 * дальше обе стороны работают обычными файлами — без прав, без служб, без
 * сетевых сокетов.
 *
 * ВАЖНО про безопасность. Каталог заявок доступен на запись обычному
 * пользователю, а исполнитель работает от SYSTEM — значит заявка НЕ может
 * содержать ни пути к программам, ни аргументов командной строки: иначе любой
 * local user получил бы выполнение кода от SYSTEM. Поэтому в заявке есть только
 * действие и текст профиля, а профиль проходит проверку `isSafeConfigText`
 * (ограниченный набор символов, ограниченная длина). Клиента туннеля исполнитель
 * находит сам — рядом с собой, в ресурсах установленного приложения.
 *
 * Здесь только чистые функции и константы: их удобно закрыть тестами, а всё
 * ошибкоопасное (пути, файлы, процессы) живёт в `main/tunnelAgent.ts`.
 */

/** Имя задания планировщика, под которым живёт служебный компонент. */
export const AGENT_TASK_NAME = "TriozTunnelAgent";

/** Файл-заявка от приложения к компоненту. */
export const REQUEST_FILE = "request.json";
/** Результат выполнения последней заявки. */
export const STATUS_FILE = "status.json";
/** Признак жизни компонента: он переписывает его каждую секунду. */
export const AGENT_FILE = "agent.json";
/** Состояние поднятого туннеля: время последнего рукопожатия с узлом. */
export const TUNNEL_FILE = "tunnel.json";

/**
 * Насколько свежей должна быть отметка компонента, чтобы считать его живым.
 * Компонент пишет её раз в секунду; 15 секунд — запас на загруженную машину.
 */
export const AGENT_STALE_MS = 15_000;

/** Насколько свежей должна быть сводка о туннеле, чтобы ей верить. */
export const TUNNEL_STALE_MS = 20_000;

/** Предел размера профиля: настоящий профиль WireGuard — меньше килобайта. */
export const MAX_CONFIG_LENGTH = 8_000;

export type TunnelAction = "up" | "down";

export type TunnelRequest = {
  id: string;
  action: TunnelAction;
  /** Текст профиля; для "down" — пустая строка. */
  config: string;
};

export type RequestState = "running" | "ok" | "error";

export type TunnelStatus = {
  id: string;
  state: RequestState;
  error: string;
  at: number;
};

export type AgentHeartbeat = { pid: number; at: number };

export type TunnelReport = {
  /** Время последнего рукопожатия в секундах epoch; 0 — рукопожатия не было. */
  handshake: number;
  at: number;
};

/**
 * Общий каталог обмена. На Windows — в ProgramData: это единственное место,
 * которое видно и SYSTEM, и обычному пользователю, и не зависит от профиля.
 */
export function serviceDir(
  platform: string,
  env: Record<string, string | undefined>,
): string {
  if (platform === "win32") {
    const base = env["ProgramData"] || "C:\\ProgramData";
    return `${base}\\TrioZ\\tunnel`;
  }
  return "/var/lib/trioz/tunnel";
}

/*
 * Разрешённые символы профиля. Всё, из чего состоит настоящий профиль: ключи
 * base64, адреса, имена узлов, числа, названия параметров, разделители. Кавычек,
 * амперсандов, точек с запятой и других символов оболочки здесь НЕТ намеренно:
 * значения из профиля попадают в аргументы `netsh`, и это единственный барьер
 * против подстановки чужой команды в процесс с правами SYSTEM.
 */
const CONFIG_ALLOWED = /^[A-Za-z0-9=+/._:,#[\]()@\-\s]*$/;

/** Похож ли текст на безопасный профиль WireGuard. */
export function isSafeConfigText(config: unknown): config is string {
  if (typeof config !== "string") return false;
  if (config.length === 0 || config.length > MAX_CONFIG_LENGTH) return false;
  if (!/\[Interface\]/i.test(config)) return false;
  if (!/(^|\n)\s*PrivateKey\s*=/i.test(config)) return false;
  return CONFIG_ALLOWED.test(config);
}

/** Идентификатор заявки: только буквы, цифры и дефис. */
export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{4,64}$/.test(value);
}

function asObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Разбор заявки на стороне компонента. Возвращает null на ЛЮБОЕ отклонение:
 * компонент работает от SYSTEM и обязан быть недоверчивым к содержимому файла,
 * который может записать любой пользователь машины.
 */
export function parseRequest(raw: string): TunnelRequest | null {
  const value = asObject(raw);
  if (!value) return null;
  if (!isRequestId(value["id"])) return null;
  const action = value["action"];
  if (action !== "up" && action !== "down") return null;
  if (action === "down") return { id: value["id"], action, config: "" };
  if (!isSafeConfigText(value["config"])) return null;
  return { id: value["id"], action, config: value["config"] };
}

export function parseHeartbeat(raw: string): AgentHeartbeat | null {
  const value = asObject(raw);
  if (!value) return null;
  const pid = value["pid"];
  const at = value["at"];
  if (typeof pid !== "number" || typeof at !== "number") return null;
  return { pid, at };
}

/** Жив ли служебный компонент по его отметке. */
export function isAgentAlive(
  heartbeat: AgentHeartbeat | null,
  now: number,
): boolean {
  if (!heartbeat) return false;
  const age = now - heartbeat.at;
  /* Отметка из будущего — переведённые часы, а не живой компонент. */
  return age >= -AGENT_STALE_MS && age <= AGENT_STALE_MS;
}

export function parseStatus(raw: string): TunnelStatus | null {
  const value = asObject(raw);
  if (!value) return null;
  if (!isRequestId(value["id"])) return null;
  const state = value["state"];
  if (state !== "running" && state !== "ok" && state !== "error") return null;
  const error = value["error"];
  const at = value["at"];
  return {
    id: value["id"],
    state,
    error: typeof error === "string" ? error : "",
    at: typeof at === "number" ? at : 0,
  };
}

export function parseReport(raw: string): TunnelReport | null {
  const value = asObject(raw);
  if (!value) return null;
  const handshake = value["handshake"];
  const at = value["at"];
  if (typeof handshake !== "number" || typeof at !== "number") return null;
  return { handshake, at };
}

/**
 * Вердикт о связи по сводке компонента — тем же языком, каким его понимает
 * опрос состояния в `main/vpn.ts`.
 *
 * "unknown" означает «сводки нет или она устарела», и это НЕ повод показывать
 * зелёное состояние: именно такая трактовка когда-то давала «Соединение
 * активно», пока трафик шёл мимо туннеля.
 */
export function reportVerdict(
  report: TunnelReport | null,
  now: number,
  freshSeconds: number,
): "fresh" | "silent" | "unknown" {
  if (!report) return "unknown";
  if (Math.abs(now - report.at) > TUNNEL_STALE_MS) return "unknown";
  if (report.handshake <= 0) return "silent";
  return now / 1000 - report.handshake <= freshSeconds ? "fresh" : "silent";
}

/** Идентификатор новой заявки. Случайность нужна только для различимости. */
export function newRequestId(random: () => number = Math.random): string {
  const tail = Math.floor(random() * 1e9).toString(36);
  return `r${Date.now().toString(36)}-${tail}`;
}
