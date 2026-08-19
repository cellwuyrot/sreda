/**
 * VPN-ONECLICK: менеджер туннеля WireGuard/AmneziaWG в main-процессе оболочки.
 *
 * Это и есть та самая недостающая часть, из-за которой «кнопка VPN» раньше лишь
 * отдавала файл-профиль: теперь оболочка поднимает туннель сама. Веб-страница
 * передаёт готовый профиль (собранный на устройстве, с приватным ключом,
 * который никуда не уходит по сети), а этот модуль:
 *
 *   1. кладёт профиль во временный файл с правами 600 в каталоге приложения;
 *   2. находит установленный инструмент (wireguard.exe / wg-quick / их
 *      AmneziaWG-аналоги для обфусцированного профиля);
 *   3. поднимает туннель командой этого инструмента с повышением прав
 *      (UAC / polkit / osascript — окно ОС, а не тихий sudo);
 *   4. следит за рукопожатием и сообщает состояние в renderer;
 *   5. гарантированно снимает туннель при выключении и при выходе из приложения
 *      — иначе в режиме «весь трафик» закрытие окна оставило бы всю машину без
 *      интернета.
 *
 * Вся ошибкоопасная арифметика (выбор бинарника, экранирование при повышении
 * прав, разбор рукопожатия) вынесена в чистый `shared/vpnPlan.ts` и покрыта
 * тестами; здесь — только побочные эффекты, которые без реальной ОС не проверить.
 */

import { app } from "electron";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { getMainWindow } from "./mainWindow";
import { IPC } from "../shared/constants";
import {
  elevatedInvocation,
  handshakeQuery,
  HANDSHAKE_FRESH_SECONDS,
  isObfuscatedConfig,
  parseLatestHandshake,
  TUNNEL_CONF_FILE,
  tunnelBackendCandidates,
  tunnelDownArgs,
  tunnelUpArgs,
  type VpnBackend,
  type VpnStatePayload,
} from "../shared/vpnPlan";

const run = promisify(execFile);

/* ───────────────────────────── Состояние ───────────────────────────── */

let current: VpnStatePayload = { state: "off", since: null, error: null, backend: null };
/** Куда записан профиль, пока туннель поднят (для снятия и удаления). */
let confPath = "";
/** Каким инструментом реально подняли — нужен для команды снятия и статуса. */
let activeExe = "";
let statusTimer: ReturnType<typeof setInterval> | null = null;

/** Каталог для временного профиля: приватный ключ не должен лежать в общих temp. */
function vpnDir(): string {
  return join(app.getPath("userData"), "vpn");
}

function emit(next: VpnStatePayload): void {
  current = next;
  getMainWindow()?.webContents.send(IPC.VPN_STATE, current);
}

/** Текущее состояние — отдаётся синхронно на запрос renderer при открытии окна. */
export function vpnState(): VpnStatePayload {
  return current;
}

export function isVpnActive(): boolean {
  return current.state === "on" || current.state === "connecting";
}

/* ─────────────────────────── Поиск бинарника ─────────────────────────── */

/** Каталоги, где инструмент может лежать помимо PATH. */
function knownDirs(): string[] {
  if (process.platform === "win32") {
    const pf = process.env["ProgramFiles"] || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    return [
      join(pf, "WireGuard"),
      join(pf, "AmneziaWG"),
      join(pf, "Amnezia", "AmneziaWG"),
      join(pf86, "WireGuard"),
    ];
  }
  return ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin", "/sbin", "/usr/sbin", "/run/current-system/sw/bin"];
}

/**
 * Абсолютный путь к инструменту или null. Сначала спрашиваем систему
 * (`where` / `which`), затем пробуем известные каталоги: на Windows служба
 * WireGuard ставит `wireguard.exe` не в PATH, а в Program Files.
 */
async function findExecutable(exe: string): Promise<string | null> {
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await run(finder, [exe]);
    const first = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (first && existsSync(first)) return first;
  } catch {
    /* нет в PATH — пробуем известные каталоги ниже */
  }
  for (const dir of knownDirs()) {
    const candidate = join(dir, exe);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/* ─────────────────────────── Запуск команд ─────────────────────────── */

async function runElevated(exe: string, args: string[]): Promise<void> {
  const inv = elevatedInvocation(process.platform, exe, args);
  try {
    await run(inv.file, inv.args, { windowsHide: true, timeout: 120_000 });
  } catch (err) {
    const e = err as { code?: number; stderr?: string; killed?: boolean };
    if (e.killed) throw new Error("Команда управления туннелем не завершилась вовремя");
    /* Пользователь мог отклонить запрос прав (UAC/polkit) — это не сбой, а отказ. */
    const stderr = (e.stderr || "").trim();
    if (process.platform === "linux" && e.code === 126) {
      throw new Error("Не выданы права на поднятие туннеля (polkit отклонил запрос)");
    }
    throw new Error(stderr || "Не удалось выполнить команду управления туннелем");
  }
}

/* ─────────────────────────── Проверка связи ─────────────────────────── */

/**
 * Best-effort проверка рукопожатия: если `wg`/`awg` доступны, отличаем «на
 * связи» от «поднят, но молчит». Если инструмента статуса нет (бывает на
 * Windows, где служба ставится без консольного wg.exe в PATH), считаем туннель
 * поднятым — снять его человек всё равно сможет кнопкой.
 */
async function checkHandshake(backend: VpnBackend): Promise<"fresh" | "silent" | "unknown"> {
  const q = handshakeQuery(process.platform, backend);
  const exe = (await findExecutable(q.exe)) || q.exe;
  try {
    const { stdout } = await run(exe, q.args, { windowsHide: true, timeout: 10_000 });
    const latest = parseLatestHandshake(stdout);
    if (latest === 0) return "silent";
    return Date.now() / 1000 - latest <= HANDSHAKE_FRESH_SECONDS ? "fresh" : "silent";
  } catch {
    return "unknown";
  }
}

function startStatusPolling(backend: VpnBackend): void {
  stopStatusPolling();
  const tick = async () => {
    if (current.state !== "connecting" && current.state !== "on") return;
    const result = await checkHandshake(backend);
    if (current.state !== "connecting" && current.state !== "on") return;
    if (result === "fresh" || result === "unknown") {
      if (current.state !== "on") {
        emit({ state: "on", since: current.since ?? new Date().toISOString(), error: null, backend });
      }
    }
    // "silent" на раннем этапе — норма (первое рукопожатие идёт до ~5 c),
    // поэтому состояние не сбрасываем: connecting так и держится до первого
    // ответа сервера, а если он не придёт — человек это видит по индикатору.
  };
  void tick();
  statusTimer = setInterval(() => void tick(), 15_000);
}

function stopStatusPolling(): void {
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
}

/* ─────────────────────────────── Up / Down ─────────────────────────────── */

/** Лёгкая проверка, что нам передали именно профиль WireGuard, а не мусор. */
function looksLikeConfig(config: string): boolean {
  return /\[Interface\]/i.test(config) && /(^|\n)\s*PrivateKey\s*=/i.test(config);
}

function writeConfFile(config: string): string {
  const dir = vpnDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* Windows игнорирует POSIX-права — там каталог закрыт ACL профиля пользователя. */
  }
  const path = join(dir, TUNNEL_CONF_FILE);
  writeFileSync(path, config.endsWith("\n") ? config : `${config}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* см. выше */
  }
  return path;
}

function removeConfFile(): void {
  if (!confPath) return;
  try {
    rmSync(confPath, { force: true });
  } catch {
    /* файл мог уже исчезнуть — не мешает выключению */
  }
  confPath = "";
}

/**
 * Поднять туннель по переданному профилю. Идемпотентна для UI: если уже
 * поднимаемся/подняты, повторный вызов ничего не ломает.
 */
export async function vpnUp(config: string): Promise<VpnStatePayload> {
  if (typeof config !== "string" || !looksLikeConfig(config)) {
    emit({ state: "error", since: null, error: "Профиль подключения повреждён", backend: null });
    return current;
  }
  if (current.state === "connecting") return current;

  const obfuscated = isObfuscatedConfig(config);
  const candidates = tunnelBackendCandidates(process.platform, obfuscated);

  let chosenPath: string | null = null;
  let chosen: { exe: string; backend: VpnBackend } | null = null;
  for (const candidate of candidates) {
    const resolved = await findExecutable(candidate.exe);
    if (resolved) {
      chosenPath = resolved;
      chosen = candidate;
      break;
    }
  }

  if (!chosenPath || !chosen) {
    const missing = candidates.map((c) => c.exe).join(" / ");
    const hint = obfuscated
      ? "Для маскированного подключения установите клиент AmneziaWG."
      : "Установите WireGuard: на Windows — приложение WireGuard, на Linux — пакет wireguard-tools.";
    emit({
      state: "error",
      since: null,
      error: `Не найден инструмент туннеля (${missing}). ${hint}`,
      backend: null,
    });
    return current;
  }

  emit({ state: "connecting", since: null, error: null, backend: chosen.backend });

  try {
    // Снимаем возможный «висящий» прежний туннель, чтобы установка службы с тем
    // же именем не спорила сама с собой (актуально после жёсткого выхода).
    await tearDownQuietly(chosenPath);

    confPath = writeConfFile(config);
    activeExe = chosenPath;
    await runElevated(chosenPath, tunnelUpArgs(process.platform, confPath));

    emit({ state: "connecting", since: new Date().toISOString(), error: null, backend: chosen.backend });
    startStatusPolling(chosen.backend);
    return current;
  } catch (err) {
    removeConfFile();
    activeExe = "";
    emit({
      state: "error",
      since: null,
      error: err instanceof Error ? err.message : "Не удалось поднять туннель",
      backend: null,
    });
    return current;
  }
}

/** Снять текущий туннель, если он есть, молча (для переустановки/выхода). */
async function tearDownQuietly(exe: string): Promise<void> {
  try {
    // На Windows снимаем службу по имени; на POSIX нужен путь к профилю —
    // если его уже нет, wg-quick сам сообщит, что снимать нечего, и мы это
    // проглатываем: цель достигнута.
    const path = confPath || join(vpnDir(), TUNNEL_CONF_FILE);
    if (process.platform !== "win32" && !existsSync(path)) return;
    await runElevated(exe, tunnelDownArgs(process.platform, path));
  } catch {
    /* нечего снимать — это не ошибка */
  }
}

/** Выключить туннель по кнопке. */
export async function vpnDown(): Promise<VpnStatePayload> {
  if (current.state === "off" || current.state === "disconnecting") {
    stopStatusPolling();
    return current;
  }
  const backend = current.backend;
  const exe = activeExe || (await resolveDownExe(backend));
  emit({ state: "disconnecting", since: current.since, error: null, backend });
  stopStatusPolling();
  try {
    if (exe) {
      const path = confPath || join(vpnDir(), TUNNEL_CONF_FILE);
      await runElevated(exe, tunnelDownArgs(process.platform, path));
    }
    removeConfFile();
    activeExe = "";
    emit({ state: "off", since: null, error: null, backend: null });
  } catch (err) {
    /* Не удалось снять — честно показываем ошибку, но туннель мог и сняться:
       оставляем прежнее «поднят», чтобы кнопка позволила повторить. */
    emit({
      state: "on",
      since: current.since,
      error: err instanceof Error ? err.message : "Не удалось выключить туннель",
      backend,
    });
  }
  return current;
}

async function resolveDownExe(backend: VpnBackend | null): Promise<string> {
  const obfuscated = backend === "amneziawg";
  for (const candidate of tunnelBackendCandidates(process.platform, obfuscated)) {
    const resolved = await findExecutable(candidate.exe);
    if (resolved) return resolved;
  }
  return "";
}

/**
 * Снять туннель при выходе из приложения. Возвращает промис, чтобы `before-quit`
 * мог дождаться: иначе в режиме «весь трафик» закрытое приложение оставило бы
 * машину замкнутой на сервер без единого окна, чтобы это отменить.
 */
export async function shutdownVpn(): Promise<void> {
  stopStatusPolling();
  if (current.state === "off") {
    removeConfFile();
    return;
  }
  const backend = current.backend;
  const exe = activeExe || (await resolveDownExe(backend));
  try {
    if (exe) {
      const path = confPath || join(vpnDir(), TUNNEL_CONF_FILE);
      await runElevated(exe, tunnelDownArgs(process.platform, path));
    }
  } catch {
    /* при выходе показывать уже нечего — просто пытаемся не оставить туннель */
  } finally {
    removeConfFile();
  }
}
