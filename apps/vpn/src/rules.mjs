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
    const [publicKey, , , allowedIps, latestHandshake] = parts;
    if (!publicKey) continue;
    peers.set(publicKey, {
      allowedIps: normalizeAllowed(allowedIps),
      handshakeUnix: Number(latestHandshake) || 0,
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

/** Пиры из ответа главного сервера, пригодные к применению. */
export function acceptPeers(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (peer) => peer && typeof peer.publicKey === "string" && peer.publicKey && typeof peer.allowedIp === "string" && peer.allowedIp,
  );
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
