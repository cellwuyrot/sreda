import prisma from "@/lib/prisma";
import { hasPremium } from "@/lib/premium";
/* VPN-PLAN: отдельная подписка, которая даёт только туннель. */
import { hasActiveVpnPlan } from "@/lib/vpnPlan";
/* FIX-AWG: единая проверка параметров маскировки — и для панели, и для выдачи профиля. */
import { awgProblem } from "@/lib/awgParams";

/**
 * VPN-WG: серверная часть выдачи доступа к WireGuard.
 *
 * Главный принцип: **приватного ключа на сервере не существует**. Пара ключей
 * создаётся на устройстве владельца, приватная половина ложится в защищённое
 * хранилище ОС и никуда не отправляется; сюда приходит только публичный ключ.
 * Поэтому «выдать доступ» — это записать публичный ключ в реестр пиров, а не
 * передать кому-то секрет. Ни администратор, ни система не могут подключиться
 * от имени пользователя: у них нет и не может быть его приватного ключа.
 *
 * Раздача пиров на узлы устроена «на вытягивание»: VPN-узел сам приходит с
 * отчётом и получает в ответ список своих пиров. Узел не поднимает входящий
 * API — так связка работает и за NAT, и без обратной аутентификации (главный
 * сервер хранит лишь хеш токена узла и физически не смог бы предъявить его).
 */

/**
 * VPN-AUTOPREMIUM: право на VPN. Доступ выдаётся всем Premium автоматически —
 * никакой выдачи «по логину» администратором больше нет: она была ручным шагом
 * там, где признак и без того известен системе. Администратору доступ тоже
 * оставлен: иначе проверить сервис было бы нечем.
 */
export async function hasVpnEntitlement(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isPremium: true, role: true, vpnAccess: true, vpnAccessUntil: true },
  });
  if (!user) return false;
  /* VPN-PLAN: два равноправных основания. Второе нужно именно здесь,
     а не в `hasPremium`: подписка на VPN не делает аккаунт премиальным. */
  return hasPremium(user) || hasActiveVpnPlan(user);
}

/**
 * VPN-PANEL: настройки сервиса. Запись одна (id = "default"); если её ещё нет —
 * создаём со значениями по умолчанию, чтобы панель и маршруты не падали на
 * пустой базе. Сервис по умолчанию ВЫКЛЮЧЕН.
 */
export async function getVpnSettings() {
  return prisma.vpnSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
}

/** Подсеть туннеля. Первый адрес занимает сам сервер WireGuard. */
export const VPN_SUBNET_PREFIX = "10.8.0";
export const VPN_SERVER_ADDRESS = `${VPN_SUBNET_PREFIX}.1`;
export const VPN_ALLOWED_IPS = "0.0.0.0/0, ::/0";
export const VPN_SERVICE_ALLOWED_IPS = `${VPN_SUBNET_PREFIX}.0/24`;
export const VPN_DNS = "1.1.1.1";

/* ── VPN-ROUTING: что именно идёт через туннель ────────────────────────────
 *
 * Решение принимает человек в момент включения, а не администратор за всех.
 * Причина простая: это выбор между «сменить свой адрес в интернете» и «получить
 * доступ к сервисам TZ, не трогая остальной трафик», и у разных людей он разный
 * даже на одном устройстве в разные дни.
 *
 * Администратор задаёт лишь СМЫСЛ каждого варианта — какие подсети в него входят
 * (`VpnSettings.allowedIps` и `serviceAllowedIps`). Так у выбора остаётся ровно
 * два понятных пункта вместо строки с подсетями, которую пользователю показывать
 * незачем.
 *
 * Режим хранится у пира: профиль показывается один раз, и без записи панель не
 * смогла бы даже сказать, в каком режиме выдан доступ. Смена режима — это
 * перевыпуск профиля: `AllowedIPs` живёт в конфиге на устройстве, и поменять его
 * задним числом с сервера нельзя (приватного ключа у нас нет — собрать новый
 * профиль мы не можем).
 */
export const VPN_ROUTINGS = ["ALL", "SERVICES"] as const;
export type VpnRouting = (typeof VPN_ROUTINGS)[number];

export function isVpnRouting(value: unknown): value is VpnRouting {
  return value === "ALL" || value === "SERVICES";
}

/** Маршруты выбранного режима. Пустое значение настройки — падаем на значение по умолчанию. */
export function routingAllowedIps(
  settings: { allowedIps: string; serviceAllowedIps?: string | null },
  routing: unknown,
): string {
  if (routing === "SERVICES") {
    return settings.serviceAllowedIps?.trim() || VPN_SERVICE_ALLOWED_IPS;
  }
  return settings.allowedIps?.trim() || VPN_ALLOWED_IPS;
}
/** Диапазон адресов для пиров: .2 … .254 */
const FIRST_PEER_OCTET = 2;
const LAST_PEER_OCTET = 254;

/**
 * Публичный ключ WireGuard — 32 байта в base64, то есть ровно 44 символа с
 * завершающим «=». Проверяем и форму, и то, что база64 действительно
 * раскодируется в 32 байта: иначе в конфиг узла попадёт мусор.
 */
export function isValidWireGuardKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 44) return false;
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return false;
  try {
    return Buffer.from(value, "base64").length === 32;
  } catch {
    return false;
  }
}

/**
 * Свободный адрес в подсети узла. null — адреса кончились.
 *
 * Подсеть у каждого узла своя и одинаковая (10.8.0.0/24 на его интерфейсе),
 * поэтому занятость считается В ПРЕДЕЛАХ УЗЛА: адрес 10.8.0.2 на двух разных
 * узлах — это два разных туннеля, и мешать друг другу они не могут. Уникальность
 * в базе устроена так же (nodeId + address); раньше она была глобальной, и
 * второй VPN-узел падал на первом же выданном адресе.
 */
export async function allocateAddress(nodeId: string): Promise<string | null> {
  const taken = await prisma.vpnPeer.findMany({
    where: { nodeId },
    select: { address: true },
  });
  const used = new Set(taken.map((p) => p.address));
  for (let octet = FIRST_PEER_OCTET; octet <= LAST_PEER_OCTET; octet++) {
    const candidate = `${VPN_SUBNET_PREFIX}.${octet}`;
    if (!used.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Адрес для пира: свой прежний или новый на новом узле.
 *
 * Прежний адрес сохраняется, только пока пир остаётся на том же узле. При
 * переезде — узел выключили, и доступ выдаётся заново — адрес берётся из подсети
 * НОВОГО узла: там прежний может быть уже занят кем-то другим, и попытка
 * оставить его заканчивалась отказом на записи вместо переезда.
 */
export async function chooseAddress(
  nodeId: string,
  existing: { nodeId: string; address: string } | null | undefined,
): Promise<string | null> {
  if (existing && existing.nodeId === nodeId) return existing.address;
  return allocateAddress(nodeId);
}

/**
 * VPN-ENTITLEMENT: имеет ли владелец пира право на туннель ПРЯМО СЕЙЧАС.
 *
 * Право проверялось только в момент выдачи, а пир после этого жил своей жизнью:
 * подписка кончилась, премиум сняли руками, человека забанили — туннель
 * продолжал работать, потому что узлу его никто не переставал присылать.
 *
 * Поэтому проверка стоит там, где список пиров уходит на узел: это единственное
 * место, через которое доступ вообще существует. Любой путь потери права —
 * истёкший срок, действие администратора, бан — снимает туннель в течение
 * минуты и без отдельной задачи по расписанию. Запись пира при этом остаётся:
 * вернулась подписка — доступ вернулся с тем же адресом, без перевыпуска ключа.
 */
export function isPeerEntitled(
  user: {
    banned: boolean;
    bannedUntil: Date | null;
    isPremium: boolean;
    role: string;
    /* VPN-PLAN: поля необязательные только для того, чтобы старые вызовы
       продолжали компилироваться; в отчёте узла они выбираются всегда. */
    vpnAccess?: boolean | null;
    vpnAccessUntil?: Date | string | null;
  },
  now: Date = new Date(),
): boolean {
  /* Бан со сроком, который уже вышел, ограничением не считается — так же, как в
     lib/banCheck: иначе истёкший бан молча запрещал бы VPN навсегда. */
  if (user.banned && (!user.bannedUntil || user.bannedUntil > now)) return false;
  /* Срок VPN-подписки проверяется по дате: именно через эту функцию узлу
     уходит список пиров, и закончившаяся подписка должна снимать туннель в
     течение минуты, а не ждать задачи просрочки. */
  return hasPremium(user) || hasActiveVpnPlan(user, now);
}

/**
 * VPN-ENDPOINT: нормализация точки подключения WireGuard.
 *
 * У WireGuard нет URL — в конфиг клиента идёт `host:port` по UDP. Поэтому
 * «адрес VPN-узла» это IP или домен, при желании с портом, и ничего больше.
 * Схему (`https://`) молча срезаем: администратор, скопировавший ссылку,
 * получит рабочее значение, а не пустое поле.
 */
export const VPN_DEFAULT_PORT = 51820;

export function normalizeWgEndpoint(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let value = raw.trim().toLowerCase();
  if (!value) return "";
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/\/.*$/, "");
  if (!value) return "";

  let host = value;
  let port = VPN_DEFAULT_PORT;
  // IPv6 в квадратных скобках: [2001:db8::1]:51820
  const bracketed = /^\[([0-9a-f:]+)\](?::(\d{1,5}))?$/.exec(value);
  if (bracketed) {
    host = `[${bracketed[1]}]`;
    if (bracketed[2]) port = Number(bracketed[2]);
  } else {
    const parts = value.split(":");
    if (parts.length === 2) {
      host = parts[0];
      port = Number(parts[1]);
    } else if (parts.length > 2) {
      // Голый IPv6 без скобок — порт указать невозможно, берём стандартный.
      host = `[${value}]`;
    }
  }
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return "";
  if (!/^\[[0-9a-f:]+\]$/.test(host) && !/^[a-z0-9.-]+$/.test(host)) return "";
  return `${host}:${port}`;
}

/** Простая проверка формы IPv4 — пул задаёт администратор руками. */
function isIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** Пул внешних адресов узла из строки «1.2.3.4, 1.2.3.5». */
export function parsePublicIps(raw: string): string[] {
  return [...new Set(raw.split(",").map((item) => item.trim()).filter(isIpv4))];
}

/**
 * VPN-EXIT: выдать пиру внешний адрес выхода из пула узла.
 *
 * Берём наименее занятый адрес — так нагрузка расходится ровно, а у каждого
 * пира адрес остаётся стабильным (он записывается в пира и больше не меняется).
 * Пустая строка означает «пула нет» — узел выпустит трафик своим основным
 * адресом через MASQUERADE, то есть прежнее поведение.
 */
export async function assignExitIp(nodeId: string, publicIpsRaw: string): Promise<string> {
  const pool = parsePublicIps(publicIpsRaw);
  if (pool.length === 0) return "";

  const peers = await prisma.vpnPeer.findMany({
    where: { nodeId },
    select: { exitIp: true },
  });
  const usage = new Map<string, number>(pool.map((ip) => [ip, 0]));
  for (const peer of peers) {
    if (usage.has(peer.exitIp)) usage.set(peer.exitIp, (usage.get(peer.exitIp) ?? 0) + 1);
  }

  let best = pool[0];
  let bestCount = usage.get(best) ?? 0;
  for (const ip of pool) {
    const count = usage.get(ip) ?? 0;
    if (count < bestCount) {
      best = ip;
      bestCount = count;
    }
  }
  return best;
}

/**
 * VPN-EXIT: пересобрать закрепления после изменения пула узла.
 *
 * Адрес закрепляется за пиром один раз и намеренно не меняется. Но пул задаёт
 * человек, и он его правит: убранный из пула адрес оставался закреплённым, узел
 * продолжал делать SNAT на адрес, которого на машине больше нет, — и у таких
 * пиров молча пропадал выход в интернет. Симптом при этом самый неудобный:
 * туннель поднят, рукопожатие идёт, а сайты не открываются.
 *
 * Поэтому при смене пула затронутые пиры получают адреса зан����во: те, чей адрес
 * исчез, и те, у кого его не было вовсе (пул появился позже, чем пир). Остальных
 * не трогаем — смена внешнего адреса посреди работы выглядит для банков и длинных
 * сессий как смена пользователя.
 */
export async function rebalanceExitIps(nodeId: string, publicIpsRaw: string): Promise<number> {
  const pool = parsePublicIps(publicIpsRaw);
  const peers = await prisma.vpnPeer.findMany({
    where: { nodeId },
    select: { id: true, address: true, exitIp: true },
    orderBy: { address: "asc" },
  });
  if (peers.length === 0) return 0;

  if (pool.length === 0) {
    /* Пул убрали целиком — возвращаемся к общему адресу узла (MASQUERADE). */
    const stale = peers.filter((peer) => peer.exitIp);
    if (stale.length === 0) return 0;
    await prisma.vpnPeer.updateMany({ where: { id: { in: stale.map((p) => p.id) } }, data: { exitIp: "" } });
    return stale.length;
  }

  const usage = new Map<string, number>(pool.map((ip) => [ip, 0]));
  const orphans: typeof peers = [];
  for (const peer of peers) {
    if (usage.has(peer.exitIp)) usage.set(peer.exitIp, (usage.get(peer.exitIp) ?? 0) + 1);
    else orphans.push(peer);
  }
  if (orphans.length === 0) return 0;

  for (const peer of orphans) {
    let best = pool[0];
    for (const ip of pool) {
      if ((usage.get(ip) ?? 0) < (usage.get(best) ?? 0)) best = ip;
    }
    usage.set(best, (usage.get(best) ?? 0) + 1);
    await prisma.vpnPeer.update({ where: { id: peer.id }, data: { exitIp: best } });
  }
  return orphans.length;
}

/**
 * Узел, который будет обслуживать нового пира: включённый, с назначением VPN,
 * уже сообщивший свой публичный ключ и точку подключения и не набравший
 * потолок пиров. Из подходящих берём наименее загруженный.
 *
 * VPN-PANEL: вместимость учитывается отдельно от загрузки — иначе на узел
 * продолжали бы садиться пиры и после исчерпания его канала.
 */
export async function pickVpnNode(maxPeersPerNode?: number) {
  const limit = maxPeersPerNode && maxPeersPerNode > 0 ? maxPeersPerNode : (await getVpnSettings()).maxPeersPerNode;

  const nodes = await prisma.serverNode.findMany({
    where: { kind: "VPN", enabled: true },
    select: {
      id: true,
      name: true,
      url: true,
      endpointHost: true,
      transport: true,
      obfuscation: true,
      region: true,
      publicIps: true,
      lastReport: true,
      _count: { select: { vpnPeers: true } },
    },
  });

  const usable = nodes
    .map((node) => ({ node, wg: nodeTunnel(node) }))
    .filter((entry) => entry.wg.publicKey && entry.wg.endpoint)
    .filter((entry) => entry.node._count.vpnPeers < limit)
    .sort((a, b) => a.node._count.vpnPeers - b.node._count.vpnPeers);

  return usable[0] ?? null;
}

/* ── VPN-TRANSPORT: обфусцированный вариант WireGuard ──────────────────────
 *
 * Управление пирами у обфусцированного форка идентично обычному WireGuard —
 * те же `set` и `show dump`, только бинарник другой. Поэтому на нашей стороне
 * разница сводится к одному: в профиль клиента добавляется блок параметров,
 * который узел сообщил в отчёте. Ни модель раздачи пиров, ни выдача адресов,
 * ни выключатель сервиса от этого не меняются.
 *
 * Параметры задаются на уровне интерфейса, а не пира: у всех клиентов одного
 * узла они одинаковые. Отсюда и место хранения — карточка узла.
 */

export const TRANSPORTS = ["PLAIN", "OBFUSCATED"] as const;
export type Transport = (typeof TRANSPORTS)[number];

export function isTransport(value: unknown): value is Transport {
  return value === "PLAIN" || value === "OBFUSCATED";
}

/** Числовые параметры и их допустимые границы — по спецификации форка. */
const NUMERIC_BOUNDS: Record<string, [number, number]> = {
  Jc: [0, 10],
  Jmin: [0, 1280],
  Jmax: [0, 1280],
  S1: [0, 64],
  S2: [0, 64],
  S3: [0, 64],
  S4: [0, 32],
};
/** Заголовки: одно число или диапазон «x-y». */
const HEADER_KEYS = ["H1", "H2", "H3", "H4"] as const;
/** Пакеты-подписи: произвольные строки, отдаём как есть. */
const SIGNATURE_KEYS = ["I1", "I2", "I3", "I4", "I5"] as const;

export type Obfuscation = Record<string, string | number>;

/**
 * Разбор параметров из отчёта узла.
 *
 * Значения приходят с чужой машины, поэтому проверяются: числа — на диапазон,
 * заголовки — на форму, подписи — на длину. Мусор молча отбрасывается: попасть
 * в клиентский профиль он не должен ни при каких обстоятельствах, а падать
 * из-за одного кривого поля тоже незачем.
 */
export function parseObfuscation(raw: string | null | undefined): Obfuscation | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const source = parsed as Record<string, unknown>;
  const out: Obfuscation = {};

  for (const [key, [min, max]] of Object.entries(NUMERIC_BOUNDS)) {
    const value = Number(source[key]);
    if (Number.isInteger(value) && value >= min && value <= max) out[key] = value;
  }
  for (const key of HEADER_KEYS) {
    const value = source[key];
    const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
    if (/^\d{1,10}(-\d{1,10})?$/.test(text)) out[key] = text;
  }
  for (const key of SIGNATURE_KEYS) {
    const value = source[key];
    if (typeof value === "string" && value.trim() && value.length <= 512) out[key] = value.trim();
  }

  // Пустой набор равносилен обычному WireGuard — тогда и блока не нужно.
  if (Object.keys(out).length === 0) return null;

  /*
   * FIX-AWG: набор проверяется ЦЕЛИКОМ, а не по одному полю.
   *
   * Проверка диапазонов выше отбрасывает мусор поштучно, и этого мало: беда
   * приходит от согласованности, а не от отдельных значений. Например при
   * `S1 + 56 === S2` все числа лежат в границах, но два типа служебных пакетов
   * перестают различаться и рукопожатие не сходится вообще. Второй случай —
   * неполный набор: половина параметров хуже, чем ни одного, потому что клиент
   * и узел посчитают размеры по-разному.
   *
   * Отказ здесь означает откат к ОБЫЧНОМУ WireGuard, а не отсутствие туннеля:
   * клиент получит рабочий профиль без маскировки. Это ровно та развилка, где
   * «работает, но заметнее» безусловно лучше, чем «не подключается никогда».
   */
  if (awgProblem(out) !== "") return null;

  return out;
}

/**
 * VPN-ENDPOINT: итоговые параметры туннеля узла.
 *
 * Публичный ключ знает только сам узел — он приходит отчётом. Точку подключения
 * задаёт панель: узел за NAT своего внешнего адреса не знает и в отчёте пишет
 * то, что ему прописали в переменной окружения. Значение из панели поэтому
 * главнее, а отчёт остаётся запасным вариантом.
 */
export function nodeTunnel(node: {
  endpointHost: string;
  lastReport: string | null;
  transport?: string;
  obfuscation?: string;
}): {
  publicKey: string | null;
  endpoint: string | null;
  obfuscation: Obfuscation | null;
} {
  const reported = readWgReport(node.lastReport);
  return {
    publicKey: reported.publicKey,
    endpoint: normalizeWgEndpoint(node.endpointHost) || reported.endpoint,
    /* FIX-AWG-ONLY: параметры маскировки выдаются, когда узел объявлен
       маскированным.

       Раньше здесь стояла заглушка (FIX-NOAWG): маскировка не выдавалась
       никогда, потому что на узле не было работающего awg-интерфейса, и профиль
       со строками Jc/S1/H1 упирался в обычный WireGuard. Теперь узел поднимает
       awg0 через amneziawg-tools, а в сборке лежит amneziawg.exe, поэтому
       заглушка стала прямо противоположной проблемой: маскированный узел
       получал обычные профили и молча отбрасывал рукопожатия.

       Условие по transport обязательно: на обычном узле лишние строки в профиле
       сломали бы подключение так же молча, только в другую сторону. */
    obfuscation:
      node.transport === "OBFUSCATED" ? parseObfuscation(node.obfuscation) : null,
  };
}

/** Что VPN-узел сообщает о себе в отчёте: публичный ключ и точка подключения. */
export function readWgReport(lastReport: string | null): { publicKey: string | null; endpoint: string | null } {
  if (!lastReport) return { publicKey: null, endpoint: null };
  try {
    const parsed = JSON.parse(lastReport) as Record<string, unknown>;
    const publicKey = isValidWireGuardKey(parsed.wgPublicKey) ? parsed.wgPublicKey : null;
    const endpoint = typeof parsed.endpoint === "string" && parsed.endpoint.includes(":") ? parsed.endpoint : null;
    return { publicKey, endpoint };
  } catch {
    return { publicKey: null, endpoint: null };
  }
}
