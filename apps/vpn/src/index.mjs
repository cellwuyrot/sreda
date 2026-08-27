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

let WG_TOOL = process.env.WG_TOOL || "awg";

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

async function wg(args, options) {
  return run(await detectTool(), args, options);
}

const CONFIG = {
  mainUrl: (process.env.TRIOZ_MAIN_URL || "").replace(/\/+$/, ""),
  token: process.env.TRIOZ_AGENT_TOKEN || "",
  iface: process.env.WG_INTERFACE || "awg0",
  port: Number(process.env.WG_PORT || 51820),
  endpointHost: process.env.WG_ENDPOINT_HOST || "",
  privateKeyPath: process.env.WG_PRIVATE_KEY_PATH || "/etc/amneziawg/trioz-private.key",
  mtu: Number(process.env.WG_MTU || 1420),
  intervalMs: Number(process.env.TRIOZ_REPORT_INTERVAL_MS || 60_000),
};

const VERSION = "0.1.0";

const PARAM_KEYS = new Set([
  "Jc", "Jmin", "Jmax",
  "S1", "S2", "S3", "S4",
  "H1", "H2", "H3", "H4",
  "I1", "I2", "I3", "I4", "I5",
]);

function readInterfaceParams() {
  const path = process.env.WG_CONF_PATH || `/etc/amneziawg/${CONFIG.iface}.conf`;
  const fallback = `/etc/amnezia/amneziawg/${CONFIG.iface}.conf`;
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

async function ensurePrivateKey() {
  if (existsSync(CONFIG.privateKeyPath)) {
    return readFileSync(CONFIG.privateKeyPath, "utf8").trim();
  }
  log("приватного ключа нет — создаём новый:", CONFIG.privateKeyPath);
  const { stdout } = await wg(["genkey"]);
  const key = stdout.trim();
  mkdirSync(dirname(CONFIG.privateKeyPath), { recursive: true, mode: 0o700 });
  const tmpPath = `${CONFIG.privateKeyPath}.tmp`;
  writeFileSync(tmpPath, `${key}\n`, { mode: 0o600 });
  chmodSync(tmpPath, 0o600);
  renameSync(tmpPath, CONFIG.privateKeyPath);
  return key;
}

async function derivePublicKey(privateKey) {
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

async function currentPeers() {
  const { stdout } = await wg(["show", CONFIG.iface, "dump"]);
  return parseDump(stdout);
}

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

let appliedExitSignature = "";

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

  // *** ИСПРАВЛЕНИЕ: накопительные счётчики трафика по каждому пиру.
  // parseDump() читает rxBytes/txBytes из `wg show dump`.
  // Сервер сам считает прирост и обрабатывает сброс при перезапуске интерфейса.
  const transfers = [];
  for (const [key, info] of peers) {
    transfers.push({ publicKey: key, rx: info.rxBytes, tx: info.txBytes });
  }

  const body = {
    report: {
      peers: peers.size,
      wgPublicKey: publicKey,
      endpoint: CONFIG.endpointHost ? `${CONFIG.endpointHost}:${CONFIG.port}` : "",
      tool: await detectTool(),
    },
    obfuscation: readInterfaceParams(),
    handshakes,
    transfers, // *** ИСПРАВЛЕНИЕ: добавлено поле transfers
  };

  const res = await fetch(`${CONFIG.mainUrl}/api/servers/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${CONFIG.token}` },
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
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
      log("не удалось отчитаться:", err instanceof Error ? err.message : err);
    }
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));