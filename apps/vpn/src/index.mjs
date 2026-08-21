#!/usr/bin/env node
/**
 * TrioZ VPN — агент дочернего узла WireGuard.
 *
 * Работает по модели «на вытягивание»: узел сам приходит к главному серверу с
 * отчётом и получает в ответ полный список своих пиров, после чего приводит
 * интерфейс WireGuard к этому списку. Входящего API у узла нет вовсе — поэтому
 * он спокойно живёт за NAT, не требует открытых портов кроме самого UDP
 * WireGuard и не нуждается в обратной аутентификации (главный сервер хранит
 * лишь SHA-256 токена узла и физически не смог бы предъявить его).
 *
 * Про ключи. Приватный ключ ИНТЕРФЕЙСА создаётся здесь, на узле, и никуда не
 * уходит: наружу сообщается только публичный. Приватные ключи ПОЛЬЗОВАТЕЛЕЙ
 * узел не видит никогда — они создаются на устройствах владельцев и остаются
 * там. Узел знает лишь публичные ключи и выданные адреса, то есть ровно
 * столько, сколько нужно для маршрутизации.
 *
 * Намеренно без зависимостей и без сборки: это маленький системный агент,
 * который должен запускаться на голой машине одной командой `node`. Любая
 * лишняя зависимость здесь — это ещё один способ сломать прод.
 */

import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";

import {
  acceptPeers,
  chainAttachCommands,
  chainFillCommands,
  exitRules,
  parseDump,
  mssCommands,
  parseInterfaceParams,
  peerChanges,
  rulesSignature,
  SNAT_CHAIN,
} from "./rules.mjs";

const run = promisify(execFile);

/**
 * FIX-WGPUBKEY: запуск команды с данными на стандартном входе.
 *
 * `execFile` не умеет опцию `input` — она есть только у синхронного
 * `execFileSync`. Из-за этого `wg pubkey` не получал приватный ключ и не видел
 * конца ввода: процесс агента вставал навсегда ещё до первого отчёта, а в
 * журнале не появлялось ни одной строки — снаружи это выглядело как «служба
 * запущена и молчит». Поэтому ключ пишем в stdin руками и закрываем поток.
 */
function runWithInput(file, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
    child.stdin.on("error", reject);
    child.stdin.end(input);
  });
}

/**
 * VPN-TRANSPORT: каким инструментом управлять интерфейсом.
 *
 * Обфусцированный форк WireGuard ставит бинарник `awg` с тем же набором команд,
 * что и `wg`: `set`, `show <iface> dump`, `genkey`, `pubkey`. Поэтому агенту
 * достаточно выбрать имя — вся остальная логика не меняется. Выбор
 * автоматический: если на машине есть `awg`, значит интерфейс поднят им.
 * Переменная `WG_TOOL` оставлена для случая, когда на узле стоят оба.
 */
let WG_TOOL = process.env.WG_TOOL || "";

async function detectTool() {
  if (WG_TOOL) return WG_TOOL;
  for (const candidate of ["awg", "wg"]) {
    try {
      await run(candidate, ["--version"]);
      WG_TOOL = candidate;
      return WG_TOOL;
    } catch {
      /* нет такого бинарника — пробуем следующий */
    }
  }
  WG_TOOL = "wg";
  return WG_TOOL;
}

/** Обёртка, чтобы нигде ниже не приходилось помнить про выбор инструмента. */
async function wg(args, options) {
  return run(await detectTool(), args, options);
}

const CONFIG = {
  mainUrl: (process.env.TRIOZ_MAIN_URL || "").replace(/\/+$/, ""),
  token: process.env.TRIOZ_AGENT_TOKEN || "",
  iface: process.env.WG_INTERFACE || "wg0",
  port: Number(process.env.WG_PORT || 51820),
  /** Адрес, по которому клиенты видят этот узел (домен или IP). */
  endpointHost: process.env.WG_ENDPOINT_HOST || "",
  privateKeyPath: process.env.WG_PRIVATE_KEY_PATH || "/etc/wireguard/trioz-private.key",
  /* FIX-MSS: MTU туннельного интерфейса узла. Нужен только для подгонки MSS:
     сам интерфейс агент не поднимает и MTU ему не меняет. */
  mtu: Number(process.env.WG_MTU || 1420),
  intervalMs: Number(process.env.TRIOZ_REPORT_INTERVAL_MS || 60_000),
};

const VERSION = "0.1.0";

/**
 * Дополнительные параметры интерфейса из его конфига.
 *
 * Читаем файл, а не спрашиваем демон: `show` их не отдаёт, а `showconf` печатает
 * приватный ключ узла — его незачем даже держать в памяти этого процесса.
 * Берётся только секция `[Interface]`: в `[Peer]` таких ключей нет, а вот
 * наткнуться на чужую строку оттуда — легко.
 */
const PARAM_KEYS = new Set([
  "Jc", "Jmin", "Jmax",
  "S1", "S2", "S3", "S4",
  "H1", "H2", "H3", "H4",
  "I1", "I2", "I3", "I4", "I5",
]);

function readInterfaceParams() {
  const path = process.env.WG_CONF_PATH || `/etc/amnezia/amneziawg/${CONFIG.iface}.conf`;
  const fallback = `/etc/wireguard/${CONFIG.iface}.conf`;
  let text = "";
  for (const candidate of [path, fallback]) {
    try {
      text = readFileSync(candidate, "utf8");
      break;
    } catch {
      /* нет файла — пробуем следующий */
    }
  }
  return parseInterfaceParams(text, PARAM_KEYS);
}

function log(...args) {
  console.log(new Date().toISOString(), "[vpn-agent]", ...args);
}

function fail(message) {
  console.error(new Date().toISOString(), "[vpn-agent] ОШИБКА:", message);
  process.exit(1);
}

/* ─────────────────────────── Ключи интерфейса ─────────────────────────── */

/**
 * Приватный ключ узла: читаем существующий или создаём новый с правами 600.
 * Ключ не пересоздаётся при перезапуске — иначе все клиенты разом потеряли бы
 * связь, ведь они помнят публичный ключ сервера.
 */
async function ensurePrivateKey() {
  if (existsSync(CONFIG.privateKeyPath)) {
    return readFileSync(CONFIG.privateKeyPath, "utf8").trim();
  }
  log("приватного ключа нет — создаём новый:", CONFIG.privateKeyPath);
  const { stdout } = await wg(["genkey"]);
  const key = stdout.trim();
  mkdirSync(dirname(CONFIG.privateKeyPath), { recursive: true, mode: 0o700 });

  /* FIX-ATOMIC: запись во временный файл и переименование вместо прямой записи.
     Прямая запись создаёт окно, в котором файл уже существует, но пуст или
     обрезан. Если в этот момент узел перезагрузится, агент при следующем
     запуске увидит файл на месте, прочтёт пустоту и уедет в отказ — а восстановить
     ключ уже невозможно: все клиенты помнят СТАРЫЙ публичный ключ узла.
     Права выставляются ДО переименования, чтобы ключ ни одного мгновения не
     лежал в итоговом пути с широкими правами. */
  const tmpPath = `${CONFIG.privateKeyPath}.tmp`;
  writeFileSync(tmpPath, `${key}\n`, { mode: 0o600 });
  chmodSync(tmpPath, 0o600);
  renameSync(tmpPath, CONFIG.privateKeyPath);
  return key;
}

async function derivePublicKey(privateKey) {
  // FIX-WGPUBKEY: приватный ключ уходит в stdin через runWithInput, а не через
  // несуществующую у execFile опцию `input`.
  const { stdout } = await runWithInput(await detectTool(), ["pubkey"], `${privateKey}\n`);
  return stdout.trim();
}

/* ────────────────────────────── Интерфейс ────────────────────────────── */

async function interfaceExists() {
  try {
    await wg(["show", CONFIG.iface]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Текущие пиры интерфейса из `wg show <iface> dump`.
 *
 * Первая строка dump описывает сам интерфейс, дальше по строке на пира:
 * публичный ключ, preshared, endpoint, allowed-ips, время рукопожатия, rx, tx,
 * keepalive.
 */
async function currentPeers() {
  const { stdout } = await wg(["show", CONFIG.iface, "dump"]);
  return parseDump(stdout);
}

/** Привести интерфейс к присланному списку пиров. */
async function applyPeers(desired) {
  const present = await currentPeers();
  const { toSet, toRemove, total } = peerChanges(present, desired);

  for (const peer of toSet) {
    await wg(["set", CONFIG.iface, "peer", peer.publicKey, "allowed-ips", peer.allowedIp]);
  }
  for (const publicKey of toRemove) {
    await wg(["set", CONFIG.iface, "peer", publicKey, "remove"]);
  }

  if (toSet.length || toRemove.length) {
    log(`пиры обновлены: +${toSet.length} / -${toRemove.length}, всего ${total}`);
  }
  return { total, added: toSet.length, removed: toRemove.length };
}

/* ───────────────────────── Внешние адреса выхода ───────────────────────── */

/**
 * VPN-EXIT: закреплённые внешние адреса.
 *
 * Правила живут в ОТДЕЛЬНОЙ цепочке: её можно безопасно очищать целиком, не
 * задевая MASQUERADE и прочие правила, которые администратор прописал в
 * POSTROUTING руками. Пир без закреплённого адреса просто проваливается дальше
 * и выходит общим адресом узла — прежнее поведение.
 *
 * Как цепочка прицепляется к POSTROUTING и почему именно первым правилом —
 * см. rules.mjs: там же причина, по которой прежний порядок не работал вовсе.
 */
/** Подпись применённого набора: не трогаем iptables, если ничего не изменилось. */
let appliedExitSignature = "";

/**
 * Выполнить набор команд iptables, уважая пометки «можно молча не получиться».
 *
 * FIX-MSS6: команда с пометкой `ipv6` уезжает в `ip6tables`. Отдельные две
 * программы — не наша выдумка, а устройство Linux: правила IPv4 на IPv6-трафик
 * не действуют вообще. Именно поэтому подгонка размера пакета раньше работала
 * лишь для части сайтов: IPv6-соединения продолжали виснуть на больших
 * ответах, и со стороны это выглядело как «интернет через VPN тормозит».
 */
async function iptablesBatch(commands) {
  for (const command of commands) {
    const attempts = command.repeat ?? 1;
    const tool = command.ipv6 ? "ip6tables" : "iptables";
    for (let i = 0; i < attempts; i++) {
      try {
        await run(tool, command.args);
      } catch {
        if (!command.ignoreError) throw new Error(`${tool} ${command.args.join(" ")}`);
        break;
      }
    }
  }
}

async function applyExitRules(peers) {
  const rules = exitRules(peers);
  const signature = rulesSignature(rules);
  if (signature === appliedExitSignature) return;

  await iptablesBatch(chainAttachCommands());
  await iptablesBatch(chainFillCommands(rules));

  appliedExitSignature = signature;
  log(`внешние адреса: закреплено правил ${rules.length} (цепочка ${SNAT_CHAIN} первой в POSTROUTING)`);
}

/* ─────────────────────────────── Отчёт ─────────────────────────────── */

/**
 * FIX-MSS: подгонка MSS на узле.
 *
 * Применяется один раз за жизнь процесса: правила не зависят от списка пиров,
 * а дёргать iptables каждую минуту ради неизменного набора — та самая тихая
 * работа впустую, из-за которой растёт загрузка и пухнет журнал.
 */
let mssApplied = false;

async function applyMss() {
  if (mssApplied) return;
  await iptablesBatch(mssCommands(CONFIG.iface, CONFIG.mtu));
  mssApplied = true;
  log(`размер пакета: MSS подогнан под MTU ${CONFIG.mtu}`);
}

async function report(publicKey) {
  const peers = await currentPeers().catch(() => new Map());

  // Рукопожатия — чтобы владелец видел в интерфейсе, живёт ли его подключение.
  const handshakes = [];
  for (const [key, info] of peers) {
    if (info.handshakeUnix > 0) handshakes.push({ publicKey: key, atMs: info.handshakeUnix * 1000 });
  }

  /* FIX-TELEMETRY: в отчёте больше нет ни версии агента, ни времени работы.
     Обоих полей никто не использовал для работы сервиса, зато они отвечают на
     два вопроса, полезные только атакующему: что именно тут запущено и когда это
     в последний раз обновляли. Версия при живом 401 показывала ещё и то, что узел
     жив, до любой проверки токена. Адреса пиров и их endpoint тут не было и не
     будет: это адреса людей. */
  const body = {
    report: {
      peers: peers.size,
      wgPublicKey: publicKey,
      endpoint: CONFIG.endpointHost ? `${CONFIG.endpointHost}:${CONFIG.port}` : "",
      tool: await detectTool(),
    },
    /* Параметры интерфейса идут отдельным полем, а не внутри отчёта: отчёт
       целиком показывается в панели как диагностика, а эти значения нужны
       только для подстановки в клиентский профиль. */
    obfuscation: readInterfaceParams(),
    handshakes,
  };

  const res = await fetch(`${CONFIG.mainUrl}/api/servers/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${CONFIG.token}` },
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    // Токен отозван или узел отключён администратором: молча продолжать
    // бессмысленно, пусть systemd перезапустит нас позже.
    fail("главный сервер не принял токен агента (401). Перевыпустите токен в админ-панели.");
  }
  if (!res.ok) throw new Error(`отчёт отклонён: HTTP ${res.status}`);

  return res.json();
}

/* ─────────────────────────────── Цикл ─────────────────────────────── */

async function tick(publicKey) {
  const answer = await report(publicKey);
  if (Array.isArray(answer?.peers)) {
    const peers = acceptPeers(answer.peers);
    await applyPeers(peers);
    // VPN-EXIT: правила закрепления внешнего адреса приезжают тем же отчётом.
    await applyExitRules(peers).catch((err) =>
      log("не удалось применить внешние адреса:", err instanceof Error ? err.message : err),
    );
    await applyMss().catch((err) =>
      log("не удалось подогнать размер пакета:", err instanceof Error ? err.message : err),
    );
  }
  return Number(answer?.nextReportInMs) || CONFIG.intervalMs;
}

async function main() {
  if (!CONFIG.mainUrl) fail("не задан TRIOZ_MAIN_URL — адрес главного сервера");
  if (!CONFIG.token) fail("не задан TRIOZ_AGENT_TOKEN — токен из админ-панели (Серверы)");
  if (!CONFIG.endpointHost) log("ВНИМАНИЕ: WG_ENDPOINT_HOST не задан, клиентам некуда подключаться");

  if (!(await interfaceExists())) {
    fail(
      `интерфейс ${CONFIG.iface} не найден. Поднимите его до запуска агента ` +
        `(см. README: wg-quick up ${CONFIG.iface} или systemd-юнит).`,
    );
  }

  const privateKey = await ensurePrivateKey();
  const publicKey = await derivePublicKey(privateKey);
  /* FIX-LOGKEY: в журнал идёт лишь начало публичного ключа. Он не секретен, но
     однозначно определяет узел, а журналы уезжают в сборщики и выдачи
     поддержки; для сверки с панелью восьми символов достаточно. */
  log(`узел готов (агент ${VERSION}): интерфейс ${CONFIG.iface}, публичный ключ ${publicKey.slice(0, 8)}…`);

  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      stopping = true;
      log("остановка по", signal);
      process.exit(0);
    });
  }

  while (!stopping) {
    let waitMs = CONFIG.intervalMs;
    try {
      waitMs = await tick(publicKey);
    } catch (err) {
      // Сеть могла пропасть или главный сервер перезапускается: ждём и пробуем
      // снова. Пиры при этом остаются как были — доступ не рвётся.
      log("не удалось отчитаться:", err instanceof Error ? err.message : err);
    }
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
