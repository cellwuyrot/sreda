/**
 * VPN-EMBEDDED: чистая логика ВСТРОЕННОГО клиента туннеля.
 *
 * Зачем этот модуль появился. С `VPN-ONECLICK` оболочка перестала отдавать
 * файл-профиль и стала поднимать туннель сама — но поднимала она его ЧУЖИМ
 * клиентом: искала в системе `wireguard.exe` или `wg-quick` и, не найдя,
 * честно писала «установите WireGuard». То есть кнопка включения работала
 * только у того, кто до неё уже скачал сторонний клиент. Для человека это
 * выглядит так, будто своего VPN в приложении нет.
 *
 * Теперь клиент — часть сборки. Приложение носит с собой бинарник
 * пользовательской реализации WireGuard (`wireguard-go` / `amneziawg-go` на
 * Linux и macOS, служба `wireguard.exe` на Windows) в своих ресурсах и
 * настраивает туннель САМО, по протоколу UAPI, не вызывая `wg`/`wg-quick`.
 * Скачивать пользователю нечего.
 *
 * Здесь — только чистые функции: разбор профиля, сборка UAPI-запроса, список
 * команд настройки интерфейса. Ни одного побочного эффекта: всё, что ломается
 * тихо (перевод ключей base64 → hex, порядок строк UAPI, маршрут по умолчанию
 * через fwmark), закрыто тестами. Запуск процессов — в `main/vpnHelper.ts`.
 */

import { TUNNEL_NAME, type VpnBackend } from "./vpnPlan";

/**
 * Метка маршрутизации для режима «весь трафик». Тем же числом помечаются пакеты
 * самого туннеля (`fwmark` в UAPI) и таблица маршрутов, чтобы исходящие пакеты
 * WireGuard не заворачивались в сам туннель — классическая петля, из-за которой
 * соединение поднимается и сразу умирает. Значение совпадает с тем, что
 * использует `wg-quick` (51820), — так две реализации не спорят друг с другом.
 */
export const ROUTE_MARK = 51820;

/** Имя каталога с встроенными бинарниками внутри ресурсов приложения. */
export const EMBEDDED_DIR = "wireguard";

/**
 * Имя встроенного бинарника клиента для платформы и стека.
 *
 * Windows: `wireguard.exe` — официальная служба туннеля. Она лежит в ресурсах
 * приложения, поэтому «установленный WireGuard» больше не нужен: службу ставит
 * наш собственный файл.
 *
 * Linux/macOS: пользовательская реализация на Go. Она не требует ни модуля
 * ядра, ни пакета `wireguard-tools`, а туннель настраивается через UAPI-сокет
 * — то есть без `wg` и `wg-quick`.
 */
export function embeddedClientName(platform: NodeJS.Platform, backend: VpnBackend): string {
  if (platform === "win32") {
    return backend === "amneziawg" ? "amneziawg.exe" : "wireguard.exe";
  }
  return backend === "amneziawg" ? "amneziawg-go" : "wireguard-go";
}

/* ────────────────────────── Разбор профиля ────────────────────────── */

export interface ParsedWgPeer {
  publicKey: string;
  presharedKey: string | null;
  endpoint: string | null;
  allowedIps: string[];
  persistentKeepalive: number | null;
}

export interface ParsedWgConfig {
  privateKey: string;
  /** Адреса интерфейса вида `10.8.0.7/32`. */
  addresses: string[];
  dns: string[];
  mtu: number | null;
  /** Параметры маскировки AmneziaWG (Jc, S1, H1…) — как есть, ключ к значению. */
  extra: Record<string, string>;
  peers: ParsedWgPeer[];
}

/** Значения `AllowedIPs`/`DNS` перечисляются через запятую. */
function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Разбор профиля WireGuard в структуру.
 *
 * Разбираем сами, а не отдаём файл сторонней утилите, потому что настраивать
 * туннель мы будем через UAPI, где нужны отдельные поля, а не текст профиля.
 * Регистр ключей в профиле произвольный (`PrivateKey`, `privatekey`), поэтому
 * сравнение — по нижнему регистру.
 */
export function parseWgConfig(config: string): ParsedWgConfig {
  const result: ParsedWgConfig = {
    privateKey: "",
    addresses: [],
    dns: [],
    mtu: null,
    extra: {},
    peers: [],
  };
  /** Ключи маскировки: в UAPI уходят в нижнем регистре, поэтому храним имя как есть. */
  const obfuscationKeys = new Set([
    "jc", "jmin", "jmax",
    "s1", "s2", "s3", "s4",
    "h1", "h2", "h3", "h4",
    "i1", "i2", "i3", "i4", "i5",
  ]);

  let section: "none" | "interface" | "peer" = "none";
  let peer: ParsedWgPeer | null = null;

  const closePeer = () => {
    if (peer && peer.publicKey) result.peers.push(peer);
    peer = null;
  };

  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;

    if (line.startsWith("[")) {
      const name = line.slice(1, line.indexOf("]") === -1 ? undefined : line.indexOf("]")).toLowerCase();
      if (name === "interface") {
        closePeer();
        section = "interface";
      } else if (name === "peer") {
        closePeer();
        section = "peer";
        peer = { publicKey: "", presharedKey: null, endpoint: null, allowedIps: [], persistentKeepalive: null };
      } else {
        closePeer();
        section = "none";
      }
      continue;
    }

    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    /* Значение обрезаем только по краям: base64-ключ сам содержит `=`, поэтому
       делим строку по ПЕРВОМУ знаку равенства, а не по каждому. */
    const value = line.slice(eq + 1).trim();
    if (!value) continue;

    if (section === "interface") {
      if (key === "privatekey") result.privateKey = value;
      else if (key === "address") result.addresses.push(...splitList(value));
      else if (key === "dns") result.dns.push(...splitList(value));
      else if (key === "mtu") {
        const mtu = Number(value);
        if (Number.isFinite(mtu) && mtu > 0) result.mtu = Math.trunc(mtu);
      } else if (obfuscationKeys.has(key)) result.extra[key] = value;
      continue;
    }

    if (section === "peer" && peer) {
      if (key === "publickey") peer.publicKey = value;
      else if (key === "presharedkey") peer.presharedKey = value;
      else if (key === "endpoint") peer.endpoint = value;
      else if (key === "allowedips") peer.allowedIps.push(...splitList(value));
      else if (key === "persistentkeepalive") {
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds >= 0) peer.persistentKeepalive = Math.trunc(seconds);
      }
    }
  }
  closePeer();
  return result;
}

/** Профиль пригоден для поднятия, только если есть свой ключ и хотя бы один пир с адресом. */
export function isUsableConfig(parsed: ParsedWgConfig): boolean {
  return (
    parsed.privateKey.length > 0 &&
    parsed.addresses.length > 0 &&
    parsed.peers.some((p) => p.publicKey.length > 0 && !!p.endpoint)
  );
}

/* ────────────────────────── UAPI ────────────────────────── */

/**
 * Ключ base64 (как в профиле) → hex (как требует UAPI).
 *
 * Это ровно то место, где встроенный клиент заменяет `wg`: утилита переводила
 * ключи сама, а теперь перевод наш. Ключ WireGuard — всегда 32 байта; всё
 * остальное означает битый профиль, и лучше упасть здесь, чем поднять туннель
 * с мусорным ключом и полчаса искать, почему нет рукопожатия.
 */
export function base64KeyToHex(key: string): string {
  const raw = Buffer.from(key, "base64");
  if (raw.length !== 32) throw new Error("Ключ подключения имеет неверную длину");
  return raw.toString("hex");
}

/**
 * UAPI-запрос `set=1` для встроенного клиента.
 *
 * Порядок строк в UAPI значим: параметры устройства идут до первого
 * `public_key=`, а всё после него относится к этому пиру. Поэтому маскировка и
 * `fwmark` пишутся первыми, а `replace_peers` — до пиров.
 *
 * @param routeAll — режим «весь трафик»: помечаем пакеты туннеля меткой, иначе
 *   маршрут по умолчанию завернёт трафик самого туннеля в туннель.
 */
export function uapiSetRequest(parsed: ParsedWgConfig, routeAll: boolean, platform: NodeJS.Platform = process.platform): string {
  const lines: string[] = ["set=1", `private_key=${base64KeyToHex(parsed.privateKey)}`];

  /* Метка маршрутизации есть только в Linux: в macOS её роль играет отдельный
     маршрут до точки подключения (см. ifaceUpCommands). */
  if (routeAll && platform === "linux") lines.push(`fwmark=${ROUTE_MARK}`);

  for (const [key, value] of Object.entries(parsed.extra)) lines.push(`${key}=${value}`);

  lines.push("replace_peers=true");
  for (const peer of parsed.peers) {
    if (!peer.publicKey) continue;
    lines.push(`public_key=${base64KeyToHex(peer.publicKey)}`);
    if (peer.presharedKey) lines.push(`preshared_key=${base64KeyToHex(peer.presharedKey)}`);
    if (peer.endpoint) lines.push(`endpoint=${peer.endpoint}`);
    if (peer.persistentKeepalive !== null) {
      lines.push(`persistent_keepalive_interval=${peer.persistentKeepalive}`);
    }
    lines.push("replace_allowed_ips=true");
    for (const cidr of peer.allowedIps) lines.push(`allowed_ip=${cidr}`);
  }

  /* UAPI-запрос завершается ПУСТОЙ строкой — без неё клиент ждёт продолжения. */
  return `${lines.join("\n")}\n\n`;
}

/**
 * Разбор ответа UAPI `get=1` — время последнего рукопожатия (Unix-секунды).
 *
 * Так встроенный клиент отвечает на вопрос «связь есть?» без утилиты `wg`:
 * ответ приходит строками `ключ=значение`, нас интересует
 * `last_handshake_time_sec`.
 */
export function parseUapiHandshake(response: string): number {
  let max = 0;
  for (const line of response.split(/\r?\n/)) {
    const [key, value] = line.split("=");
    if (key?.trim() !== "last_handshake_time_sec") continue;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > max) max = seconds;
  }
  return max;
}

/** Идёт ли через туннель весь трафик (в профиле есть маршрут по умолчанию). */
export function routesEverything(parsed: ParsedWgConfig): boolean {
  return parsed.peers.some((peer) =>
    peer.allowedIps.some((cidr) => cidr === "0.0.0.0/0" || cidr === "::/0"),
  );
}

/* ────────────────────── Настройка интерфейса ────────────────────── */

/** Адрес IPv6, если в строке есть двоеточие: `ip` требует разных семейств. */
function isV6(cidr: string): boolean {
  return cidr.includes(":");
}

/** Хост точки подключения без порта (для обходного маршрута в macOS). */
export function endpointHost(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (trimmed.startsWith("[")) return trimmed.slice(1, trimmed.indexOf("]"));
  const colon = trimmed.lastIndexOf(":");
  return colon > 0 ? trimmed.slice(0, colon) : trimmed;
}

/**
 * Команды, поднимающие интерфейс после запуска встроенного клиента: адрес,
 * MTU, маршруты. Это работа, которую раньше делал `wg-quick`; теперь её делаем
 * мы, потому что `wg-quick` — часть сторонних `wireguard-tools`.
 *
 * Используются только штатные утилиты ОС (`ip` в Linux, `ifconfig`/`route` в
 * macOS) — они есть в любой системе и ничего не требуют устанавливать.
 */
export function ifaceUpCommands(
  platform: NodeJS.Platform,
  parsed: ParsedWgConfig,
  iface: string = TUNNEL_NAME,
): string[][] {
  const routeAll = routesEverything(parsed);
  const commands: string[][] = [];

  if (platform === "linux") {
    for (const address of parsed.addresses) {
      commands.push(["ip", isV6(address) ? "-6" : "-4", "address", "add", address, "dev", iface]);
    }
    if (parsed.mtu) commands.push(["ip", "link", "set", "mtu", String(parsed.mtu), "dev", iface]);
    commands.push(["ip", "link", "set", iface, "up"]);

    if (routeAll) {
      /* Маршрут по умолчанию — в отдельной таблице, а не в main: так его видно
         только помеченным пакетам, и мы не затираем системный шлюз. Правило
         `suppress_prefixlength 0` возвращает в main всё, кроме маршрута по
         умолчанию, — иначе локальная сеть (принтеры, NAS) уехала бы в туннель. */
      commands.push(["ip", "-4", "route", "add", "0.0.0.0/0", "dev", iface, "table", String(ROUTE_MARK)]);
      commands.push(["ip", "-4", "rule", "add", "not", "fwmark", String(ROUTE_MARK), "table", String(ROUTE_MARK)]);
      commands.push(["ip", "-4", "rule", "add", "table", "main", "suppress_prefixlength", "0"]);
    }
    /* Частичный режим («только сервисы»): подсети из профиля — обычными
       маршрутами. Маршрут по умолчанию здесь не нужен, метка тоже. */
    for (const peer of parsed.peers) {
      for (const cidr of peer.allowedIps) {
        if (cidr === "0.0.0.0/0" || cidr === "::/0") continue;
        commands.push(["ip", isV6(cidr) ? "-6" : "-4", "route", "add", cidr, "dev", iface]);
      }
    }
    return commands;
  }

  if (platform === "darwin") {
    for (const address of parsed.addresses) {
      const ip = address.split("/")[0] ?? address;
      commands.push(
        isV6(address)
          ? ["ifconfig", iface, "inet6", address, "alias"]
          : ["ifconfig", iface, "inet", ip, ip, "alias"],
      );
    }
    if (parsed.mtu) commands.push(["ifconfig", iface, "mtu", String(parsed.mtu)]);
    commands.push(["ifconfig", iface, "up"]);

    if (routeAll) {
      /* В macOS нет fwmark, поэтому от петли спасает точечный маршрут до самой
         точки подключения через прежний шлюз, а весь остальной трафик уходит в
         туннель двумя половинами (0/1 и 128/1): они «сильнее» маршрута по
         умолчанию, и системный шлюз при этом остаётся на месте. */
      for (const peer of parsed.peers) {
        if (!peer.endpoint) continue;
        const host = endpointHost(peer.endpoint);
        if (host && !host.includes(":")) {
          commands.push(["route", "-q", "-n", "add", "-inet", `${host}/32`, "-interface", "en0"]);
        }
      }
      commands.push(["route", "-q", "-n", "add", "-inet", "0.0.0.0/1", "-interface", iface]);
      commands.push(["route", "-q", "-n", "add", "-inet", "128.0.0.0/1", "-interface", iface]);
    }
    for (const peer of parsed.peers) {
      for (const cidr of peer.allowedIps) {
        if (cidr === "0.0.0.0/0" || cidr === "::/0") continue;
        commands.push(["route", "-q", "-n", "add", isV6(cidr) ? "-inet6" : "-inet", cidr, "-interface", iface]);
      }
    }
    return commands;
  }

  return commands;
}

/**
 * Команды уборки. Интерфейс исчезает вместе с процессом клиента, но правила
 * маршрутизации в Linux живут отдельно — их надо снять руками, иначе после
 * выключения система продолжит искать маршрут в пустой таблице и часть трафика
 * молча никуда не пойдёт.
 *
 * Каждая команда допускает неуспех: снимать может быть уже нечего.
 */
export function ifaceDownCommands(
  platform: NodeJS.Platform,
  iface: string = TUNNEL_NAME,
): string[][] {
  if (platform === "linux") {
    return [
      ["ip", "-4", "rule", "del", "table", "main", "suppress_prefixlength", "0"],
      ["ip", "-4", "rule", "del", "not", "fwmark", String(ROUTE_MARK), "table", String(ROUTE_MARK)],
      ["ip", "-4", "route", "flush", "table", String(ROUTE_MARK)],
      ["ip", "link", "del", "dev", iface],
    ];
  }
  if (platform === "darwin") {
    return [
      ["route", "-q", "-n", "delete", "-inet", "0.0.0.0/1"],
      ["route", "-q", "-n", "delete", "-inet", "128.0.0.0/1"],
      ["ifconfig", iface, "down"],
    ];
  }
  return [];
}

/**
 * Путь UAPI-сокета встроенного клиента. Каталог задан самой реализацией
 * WireGuard (её же ожидают и сторонние утилиты), поэтому он не настраивается.
 */
export function uapiSocketPath(platform: NodeJS.Platform, iface: string = TUNNEL_NAME): string {
  return platform === "darwin"
    ? `/var/run/wireguard/${iface}.sock`
    : `/var/run/wireguard/${iface}.sock`;
}
