/**
 * SERVICE-POLICY: что служебному компоненту разрешено поднимать.
 *
 * Зачем этот файл появился. Каталог заявок открыт на запись обычному
 * пользователю — иначе приложение, работающее без прав администратора, не смогло
 * бы попросить о туннеле вообще. Но исполнитель заявки работает от SYSTEM,
 * поэтому «пришла заявка» и «заявке можно верить» — разные вещи. Проверка
 * `isSafeConfigText` закрывала только подстановку команды оболочки; сам ПРОФИЛЬ
 * при этом мог быть любым, а значит любая программа на машине могла попросить
 * систему завернуть весь трафик на свой сервер со своим DNS. Это перехват
 * трафика без единого повышения прав, и снаружи он выглядит как штатно
 * работающий VPN.
 *
 * Поэтому здесь описано, КУДА вообще разрешено строить туннель: список точек
 * подключения, список серверов имён, допустимые маршруты и подсеть адреса.
 * Профиль, который в этот список не укладывается, отклоняется — даже если он
 * синтаксически безупречен.
 *
 * Почему список лежит в коде, а не в файле рядом с заявкой. Файл рядом с заявкой
 * может переписать тот же обычный пользователь, и проверка потеряла бы смысл.
 * Код живёт в `Program Files`, куда без прав администратора не пишут. Файл
 * `policy.json` в каталоге СОСТОЯНИЯ (он открыт на запись только системе)
 * допускается как перекрытие для своих сборок — там его может положить только
 * администратор.
 *
 * Здесь только чистые функции: разбор профиля и сверка со списком. Никаких
 * файлов и процессов — это делает `main/tunnelAgent.ts`.
 */

/** Разрешённое для туннеля. Пустой список любого поля означает «не ограничено». */
export type TunnelPolicy = {
  /** Хосты точек подключения. Значение `*.trioz.ru` разрешает поддомены. */
  endpointHosts: string[];
  /** Порты точек подключения. */
  endpointPorts: number[];
  /** Серверы имён, которые профиль вправе назначить туннелю. */
  dnsServers: string[];
  /** Допустимые записи `AllowedIPs`. */
  allowedIps: string[];
  /** Префиксы адреса интерфейса, например `10.8.0.`. */
  addressPrefixes: string[];
};

/**
 * Порты, на которых сервис вправе принимать подключения.
 *
 * 51820 — штатный порт WireGuard. Остальные нужны там, где 51820 фильтруют:
 * 443 и 8443 обычно открыты (UDP на них никем не занят), 2408 — порт, привычный
 * сетям как «WARP», то есть не выделяющийся. Ничем чужим трафик при этом не
 * прикидывается: это тот же WireGuard, просто на другом номере порта.
 */
export const ALLOWED_ENDPOINT_PORTS = [51820, 443, 8443, 2408, 51821, 51822];

/**
 * Серверы имён, разрешённые в профиле. Внутренний `10.8.0.1` — резолвер самого
 * узла: он полностью убирает утечку имён к провайдеру, потому что запросы
 * никогда не покидают туннель.
 */
export const ALLOWED_DNS = [
  "10.8.0.1",
  "1.1.1.1",
  "1.0.0.1",
  "9.9.9.9",
  "149.112.112.112",
  "8.8.8.8",
  "8.8.4.4",
];

/** Маршруты, которые вправе назначить профиль: весь трафик или подсеть сервиса. */
export const ALLOWED_ROUTES = ["0.0.0.0/0", "::/0", "10.8.0.0/24"];

export const DEFAULT_POLICY: TunnelPolicy = {
  endpointHosts: ["*.trioz.ru", "trioz.ru"],
  endpointPorts: ALLOWED_ENDPOINT_PORTS,
  dnsServers: ALLOWED_DNS,
  allowedIps: ALLOWED_ROUTES,
  addressPrefixes: ["10.8.0."],
};

/** Поля профиля, которые проверяются политикой. */
export type ConfigFields = {
  addresses: string[];
  dns: string[];
  endpoints: string[];
  allowedIps: string[];
  mtu: number | null;
};

function splitList(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

/**
 * Значения из профиля, нужные политике.
 *
 * Разбор нарочно свой, а не через `parseWgConfig`: тот собирает структуру для
 * поднятия туннеля и терпим к мелочам, а здесь важно увидеть КАЖДУЮ строку,
 * даже лишнюю или повторную — именно в них и живёт попытка обхода.
 */
export function configFields(config: string): ConfigFields {
  const out: ConfigFields = { addresses: [], dns: [], endpoints: [], allowedIps: [], mtu: null };
  for (const rawLine of String(config || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";") || line.startsWith("[")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    if (!value) continue;
    if (key === "address") out.addresses.push(...splitList(value));
    else if (key === "dns") out.dns.push(...splitList(value));
    else if (key === "endpoint") out.endpoints.push(value);
    else if (key === "allowedips") out.allowedIps.push(...splitList(value));
    else if (key === "mtu") {
      const mtu = Number(value);
      if (Number.isFinite(mtu)) out.mtu = Math.trunc(mtu);
    }
  }
  return out;
}

/** Хост точки подключения без порта; для IPv6 — из квадратных скобок. */
export function splitEndpoint(endpoint: string): { host: string; port: number } | null {
  const value = endpoint.trim();
  if (!value) return null;
  let host = "";
  let portText = "";
  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    if (close < 0) return null;
    host = value.slice(1, close);
    portText = value.slice(close + 1).replace(/^:/, "");
  } else {
    const colon = value.lastIndexOf(":");
    if (colon <= 0) return null;
    host = value.slice(0, colon);
    portText = value.slice(colon + 1);
  }
  const port = Number(portText);
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host: host.toLowerCase(), port };
}

/** Подходит ли хост под запись списка (поддерживается `*.example.com`). */
export function hostMatches(host: string, pattern: string): boolean {
  const h = host.trim().toLowerCase();
  const p = pattern.trim().toLowerCase();
  if (!h || !p) return false;
  if (p.startsWith("*.")) {
    const suffix = p.slice(1); // ".trioz.ru"
    return h.endsWith(suffix) && h.length > suffix.length;
  }
  return h === p;
}

/** Адрес IPv4 в точечной записи (без длины префикса). */
function isIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/**
 * Сверка профиля с политикой. Возвращает причину отказа человеческим языком:
 * она попадает в `status.json` и видна в приложении, поэтому должна объяснять,
 * что именно не так, и при этом не содержать ключей.
 */
export function checkConfigAgainstPolicy(
  config: string,
  policy: TunnelPolicy = DEFAULT_POLICY,
): { ok: boolean; reason: string } {
  const fields = configFields(config);

  if (fields.endpoints.length === 0) {
    return { ok: false, reason: "В профиле нет точки подключения" };
  }
  for (const endpoint of fields.endpoints) {
    const parts = splitEndpoint(endpoint);
    if (!parts) return { ok: false, reason: "Точка подключения записана неверно" };
    if (policy.endpointPorts.length && !policy.endpointPorts.includes(parts.port)) {
      return { ok: false, reason: `Порт ${parts.port} не входит в список разрешённых` };
    }
    if (policy.endpointHosts.length) {
      /* Числовой адрес узла заранее неизвестен: узлы добавляются в панели, а не
         в сборке приложения. Поэтому по имени сверяем со списком, а числовому
         адресу доверяем только вместе с проверкой остальных полей — маршрут
         на чужой сервер бесполезен без своего DNS и своих AllowedIPs. */
      const known = policy.endpointHosts.some((pattern) => hostMatches(parts.host, pattern));
      if (!known && !isIpv4(parts.host) && !parts.host.includes(":")) {
        return { ok: false, reason: "Точка подключения не принадлежит сервису" };
      }
    }
  }

  for (const dns of fields.dns) {
    if (policy.dnsServers.length && !policy.dnsServers.includes(dns)) {
      return { ok: false, reason: "Профиль назначает посторонний сервер имён" };
    }
  }

  for (const cidr of fields.allowedIps) {
    if (policy.allowedIps.length && !policy.allowedIps.includes(cidr)) {
      return { ok: false, reason: `Маршрут ${cidr} не разрешён политикой сервиса` };
    }
  }

  if (fields.addresses.length === 0) {
    return { ok: false, reason: "В профиле нет адреса интерфейса" };
  }
  for (const address of fields.addresses) {
    if (!policy.addressPrefixes.length) continue;
    const bare = address.split("/")[0] ?? "";
    if (!policy.addressPrefixes.some((prefix) => bare.startsWith(prefix))) {
      return { ok: false, reason: "Адрес интерфейса вне подсети сервиса" };
    }
  }

  if (fields.mtu !== null && (fields.mtu < 576 || fields.mtu > 1500)) {
    return { ok: false, reason: "Значение MTU вне разумных границ" };
  }

  return { ok: true, reason: "" };
}

/** Перекрытие политики из файла каталога состояния (пишет только система). */
export function parsePolicy(raw: string): TunnelPolicy | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const src = value as Record<string, unknown>;
  const strings = (key: string, fallback: string[]): string[] => {
    const list = src[key];
    if (!Array.isArray(list)) return fallback;
    const out = list.filter((item): item is string => typeof item === "string" && item.length > 0);
    return out.length ? out : fallback;
  };
  const numbers = (key: string, fallback: number[]): number[] => {
    const list = src[key];
    if (!Array.isArray(list)) return fallback;
    const out = list.filter((item): item is number => typeof item === "number" && Number.isInteger(item));
    return out.length ? out : fallback;
  };
  return {
    endpointHosts: strings("endpointHosts", DEFAULT_POLICY.endpointHosts),
    endpointPorts: numbers("endpointPorts", DEFAULT_POLICY.endpointPorts),
    dnsServers: strings("dnsServers", DEFAULT_POLICY.dnsServers),
    allowedIps: strings("allowedIps", DEFAULT_POLICY.allowedIps),
    addressPrefixes: strings("addressPrefixes", DEFAULT_POLICY.addressPrefixes),
  };
}

/** Имя файла перекрытия политики в каталоге состояния. */
export const POLICY_FILE = "policy.json";
