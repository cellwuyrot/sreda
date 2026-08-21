/**
 * Чистая логика агента: разбор вывода WireGuard и построение команд.
 *
 * Вынесено из index.mjs по одной причине — это единственная часть агента,
 * которую можно проверить без узла, без прав root и без iptables. Сам index.mjs
 * остаётся тонким: он только исполняет то, что здесь решено, и потому в тестах
 * не нуждается (там нечего проверять кроме `execFile`).
 *
 * Ничего лишнего: ни зависимостей, ни ввода-вывода. Функции получают строки и
 * возвращают данные.
 */

/* ─────────────────────────── Разбор вывода wg ─────────────────────────── */

/**
 * Пиры из `wg show <iface> dump`.
 *
 * Первая строка описывает сам интерфейс, дальше по строке на пира:
 * публичный ключ, preshared, endpoint, allowed-ips, время рукопожатия, rx, tx,
 * keepalive. Разделитель — табуляция.
 */
export function parseDump(stdout) {
  const peers = new Map();
  const lines = String(stdout || "").trim().split("\n").slice(1);
  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 5) continue;
    const [publicKey, , endpoint, allowedIps, latestHandshake, rx, tx] = parts;
    if (!publicKey) continue;
    peers.set(publicKey, {
      allowedIps: normalizeAllowed(allowedIps),
      handshakeUnix: Number(latestHandshake) || 0,
      /* DIAG: три поля ниже нужны только для диагностики и никогда не уезжают на
         главный сервер целиком: endpoint — это адрес человека, то есть ровно те
         данные, ради сокрытия которых люди включают VPN. В отчёт идёт только
         возраст рукопожатия (см. report() в index.mjs). */
      endpoint: String(endpoint || "").trim() === "(none)" ? "" : String(endpoint || "").trim(),
      rxBytes: Number(rx) || 0,
      txBytes: Number(tx) || 0,
    });
  }
  return peers;
}

/**
 * Список allowed-ips к сравнимому виду.
 *
 * `wg` печатает их через запятую с пробелом, а при пустом списке — «(none)».
 * Без приведения агент на каждом такте считал бы пира изменившимся и заново
 * выполнял `wg set` — тихая, но постоянная работа впустую.
 */
export function normalizeAllowed(value) {
  const text = String(value || "").trim();
  if (!text || text === "(none)") return "";
  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(",");
}

/** Параметры интерфейса из секции `[Interface]` его конфига. */
export function parseInterfaceParams(text, allowedKeys) {
  const out = {};
  let inInterface = false;
  for (const line of String(text || "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inInterface = trimmed.toLowerCase() === "[interface]";
      continue;
    }
    if (!inInterface || !trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!allowedKeys.has(key)) continue;
    const value = trimmed.slice(eq + 1).trim();
    if (!value) continue;
    out[key] = /^\d+$/.test(value) ? Number(value) : value;
  }
  return out;
}

/* ───────────────────────────── Сверка пиров ───────────────────────────── */

/**
 * Публичный ключ WireGuard: ровно 32 байта в base64, то есть 43 символа и «=».
 * Проверка важна не ради аккуратности: это значение уезжает аргументом в `wg set`.
 */
export const WG_KEY_RE = /^[A-Za-z0-9+/]{43}=$/;

/** Адрес пира внутри туннеля: только одиночный IPv4 с префиксом /32. */
export const PEER_CIDR_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/32$/;

/** Подсеть сервиса. Адреса вне неё — не наши и на интерфейс не попадают. */
export const PEER_SUBNET_PREFIX = "10.8.0.";

/**
 * Пиры из ответа главного сервера, пригодные к применению.
 *
 * Здесь граница доверия, и это не формальность. Список приходит сетевым
 * ответом и тут же превращается в аргументы `wg set` и `iptables ... --to-source`,
 * выполняемые от root. Раньше проверялось только «строка и не пустая», а значит
 * любой мусор в ответе (ошибка в базе, чужой ответ при подмене DNS, баг в API)
 * уезжал в команду. `execFile` спасает от оболочки, но не спасает от чужого
 * маршрута: `allowedIp = "0.0.0.0/0"` от имени одного пира забрал бы весь трафик
 * всего узла на себя — это готовый перехват трафика других людей.
 *
 * Поэтому: ключ — строго base64 нужной длины, адрес — строго /32 из нашей
 * подсети, внешний адрес — строго IPv4. Всё остальное отбрасывается молча:
 * один испорченный пир не должен ломать остальный список.
 */
export function acceptPeers(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const peer of list) {
    if (!peer || typeof peer !== "object") continue;
    const publicKey = typeof peer.publicKey === "string" ? peer.publicKey.trim() : "";
    const allowedIp = typeof peer.allowedIp === "string" ? peer.allowedIp.trim() : "";
    if (!WG_KEY_RE.test(publicKey)) continue;
    if (!isPeerCidr(allowedIp)) continue;
    /* Два пира с одним ключом — это гонка за одну запись на интерфейсе:
       побеждает тот, кто пришёл первым, остальные игнорируются. */
    if (seen.has(publicKey)) continue;
    seen.add(publicKey);
    const exitIp = typeof peer.exitIp === "string" && isIpv4(peer.exitIp.trim()) ? peer.exitIp.trim() : "";
    out.push(exitIp ? { publicKey, allowedIp, exitIp } : { publicKey, allowedIp });
  }
  return out;
}

/**
 * Одиночный адрес из подсети сервиса.
 *
 * FIX-PEERRANGE: три адреса подсети клиенту выдавать нельзя никогда:
 *
 * — `.0` — адрес самой сети;
 * — `.1` — адрес самого узла и его сервера имён;
 * — `.255` — широковещательный адрес.
 *
 * Самый опасный из них — `.1`. Пир с таким allowed-ips получает право
 * отправлять пакеты ОТ ИМЕНИ узла, а вместе с тем узел начинает шлать ему
 * ответы, предназначенные себе самому. На практике это подмена сервера имён
 * всего узла и потеря управления туннелем разом — причём без единой ошибки
 * в журнале. Прежняя проверка такой адрес пропускала: он же из нашей подсети.
 */
export function isPeerCidr(value) {
  const match = PEER_CIDR_RE.exec(String(value || ""));
  if (!match) return false;
  if (!match.slice(1).every((part) => Number(part) >= 0 && Number(part) <= 255)) return false;
  if (!String(value).startsWith(PEER_SUBNET_PREFIX)) return false;
  const host = Number(match[4]);
  return host >= 2 && host <= 254;
}

/** Просто IPv4 без префикса — для внешнего адреса выхода. */
export function isIpv4(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

/**
 * Что надо изменить на интерфейсе, чтобы он совпал с присланным списком.
 *
 * Отдельно: кого добавить или переназначить, кого снять. Ничего не выполняется —
 * решение и исполнение разделены, поэтому решение проверяемо.
 */
export function peerChanges(present, desired) {
  const wanted = new Map(desired.map((peer) => [peer.publicKey, normalizeAllowed(peer.allowedIp)]));
  const toSet = [];
  for (const [publicKey, allowedIp] of wanted) {
    const existing = present.get(publicKey);
    if (existing && existing.allowedIps === allowedIp) continue;
    toSet.push({ publicKey, allowedIp });
  }
  const toRemove = [];
  for (const publicKey of present.keys()) {
    if (!wanted.has(publicKey)) toRemove.push(publicKey);
  }
  return { toSet, toRemove, total: wanted.size };
}

/* ──────────────────────── Внешние адреса выхода ──────────────────────── */

export const SNAT_CHAIN = "TRIOZ_VPN_SNAT";

/** Закрепления «адрес в туннеле → внешний адрес», в устойчивом порядке. */
export function exitRules(peers) {
  return peers
    .filter((peer) => typeof peer.exitIp === "string" && peer.exitIp)
    .map((peer) => ({ src: String(peer.allowedIp).split("/")[0], exitIp: peer.exitIp }))
    .sort((a, b) => a.src.localeCompare(b.src));
}

/** Подпись набора: не трогаем iptables, если ничего не изменилось. */
export function rulesSignature(rules) {
  return rules.map((rule) => `${rule.src}>${rule.exitIp}`).join("|");
}

/**
 * Как прицепить свою цепочку к POSTROUTING.
 *
 * ПОРЯДОК ЗДЕСЬ — ЭТО ВСЯ СУТЬ. В `nat` цепочка проходится по порядку, а
 * MASQUERADE завершает обход: до правил, стоящих ниже, пакет уже не доходит.
 * MASQUERADE прописан в `wg0.conf` через `PostUp`, то есть появляется РАНЬШЕ
 * агента — значит вставать «в конец» нельзя, иначе закрепление внешних адресов
 * не сработает ни разу (проверено счётчиками пакетов: MASQUERADE 1, наша
 * цепочка 0).
 *
 * Поэтому цепочка вставляется ПЕРВЫМ правилом. Заодно снимаются прежние ссылки:
 * на узлах, обновившихся со старой версии, ссылка уже висит в конце, и одна
 * проверка «есть ли она» оставила бы неверный порядок навсегда. Пир без
 * закреплённого адреса из пустой цепочки просто проваливается дальше — к тому же
 * MASQUERADE.
 */
export function chainAttachCommands() {
  return [
    /* Цепочки может не быть — создаём. Ошибка «уже есть» игнорируется вызовом. */
    { args: ["-t", "nat", "-N", SNAT_CHAIN], ignoreError: true },
    /* Снимаем все прежние ссылки: и правильную, и висящую в конце, и дубли. */
    { args: ["-t", "nat", "-D", "POSTROUTING", "-j", SNAT_CHAIN], ignoreError: true, repeat: 4 },
    /* И ставим единственную — первой. */
    { args: ["-t", "nat", "-I", "POSTROUTING", "1", "-j", SNAT_CHAIN] },
  ];
}

/** Команды наполнения цепочки: сначала очистка, потом закрепления. */
export function chainFillCommands(rules) {
  return [
    { args: ["-t", "nat", "-F", SNAT_CHAIN] },
    ...rules.map((rule) => ({
      args: ["-t", "nat", "-A", SNAT_CHAIN, "-s", rule.src, "-j", "SNAT", "--to-source", rule.exitIp],
    })),
  ];
}

/* ─────────────────────── Размер пакета (MSS) ────────────────────── */

export const MSS_CHAIN = "TRIOZ_VPN_MSS";

/**
 * FIX-MSS: подгонка MSS под реальный MTU туннеля.
 *
 * Самый противный сетевой отказ из всех возможных выглядит так: туннель жив,
 * пинг идёт, DNS работает, мелкие запросы проходят — а страницы и видео виснут
 * навсегда. Причина — большой пакет, который не влез в туннель, и ICMP
 * «fragmentation needed», который где-то по дороге отбросил чей-то фаервол. Сама
 * по себе подстановка MSS не лечит причину, но убирает следствие: стороны сами
 * договариваются о размере, который точно пройдёт.
 *
 * `--clamp-mss-to-pmtu` здесь не подходит: он смотрит на MTU исходящего
 * интерфейса, а ограничение создаёт туннель на другом конце. Поэтому число
 * ставится явно: MTU туннеля минус 40 (20 IP + 20 TCP).
 */
export function mssValue(mtu) {
  const safe = Number(mtu) > 0 ? Math.trunc(Number(mtu)) : 1280;
  return Math.max(536, Math.min(1420, safe) - 40);
}

/**
 * Команды подгонки MSS для туннельного интерфейса (в обе стороны).
 *
 * FIX-MSS6: тот же набор повторяется для IPv6 с пометкой `ipv6: true` — агент
 * отправит их в `ip6tables`. Без этого подгонка действовала только на IPv4, а
 * крупные сайты давно отвечают по IPv6 — именно они и «висли».
 *
 * Запас для IPv6 на 20 байт больше: его заголовок весит 40 байт вместо 20.
 * На IPv6 ошибка в размере стоит дороже, чем на IPv4: там нет фрагментации по
 * пути вовсе, и слишком большой пакет просто исчезает.
 *
 * Ошибки IPv6-команд помечены как нефатальные: на узле без IPv6 или без
 * `ip6tables` агент должен спокойно работать дальше, а не падать в перезапуск.
 */
export function mssCommands(iface, mtu) {
  const mss = String(mssValue(mtu));
  const mss6 = String(Math.max(536, mssValue(mtu) - 20));

  const chainFor = (value, ipv6) => [
    { args: ["-t", "mangle", "-N", MSS_CHAIN], ignoreError: true, ipv6 },
    { args: ["-t", "mangle", "-F", MSS_CHAIN], ignoreError: ipv6, ipv6 },
    { args: ["-t", "mangle", "-D", "FORWARD", "-j", MSS_CHAIN], ignoreError: true, repeat: 4, ipv6 },
    { args: ["-t", "mangle", "-I", "FORWARD", "1", "-j", MSS_CHAIN], ignoreError: ipv6, ipv6 },
    {
      args: [
        "-t", "mangle", "-A", MSS_CHAIN, "-o", iface, "-p", "tcp", "--tcp-flags", "SYN,RST", "SYN",
        "-j", "TCPMSS", "--set-mss", value,
      ],
      ignoreError: ipv6,
      ipv6,
    },
    {
      args: [
        "-t", "mangle", "-A", MSS_CHAIN, "-i", iface, "-p", "tcp", "--tcp-flags", "SYN,RST", "SYN",
        "-j", "TCPMSS", "--set-mss", value,
      ],
      ignoreError: ipv6,
      ipv6,
    },
  ];

  return [...chainFor(mss, false), ...chainFor(mss6, true)];
}
