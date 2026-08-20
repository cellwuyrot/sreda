/**
 * VPN-EMBEDDED: менеджер туннеля со ВСТРОЕННЫМ клиентом.
 *
 * Что было до. С `VPN-ONECLICK` кнопка включения перестала отдавать файл-профиль и
 * стала поднимать туннель сама — но только при условии, что человек уже скачал и
 * установил СТОРОННИЙ клиент (WireGuard или AmneziaWG). Оболочка искала его
 * по PATH и в Program Files, а не найдя — предлагала установить. То есть «своего
 * лаунчера» у проекта не было: был пульт к чужому приложению.
 *
 * Что теперь. Клиент лежит внутри сборки (`resources/wireguard`), и туннель
 * поднимает именно он:
 *
 *   • Linux/macOS — встроенный `wireguard-go` / `amneziawg-go`. Настройка идёт не
 *     через `wg`/`wg-quick` (это часть сторонних wireguard-tools), а по UAPI —
 *     собственным кодом в `vpnHelper.ts`.
 *   • Windows — точно так же: `wireguard-go.exe` + `wintun.dll` из ресурсов, адреса́,
 *     маршруты и DNS — штатным `netsh`.
 *
 * Почему на Windows НЕ используется официальный `wireguard.exe`. Сначала он и
 * был взят в ресурсы — и кнопка включения падала с «The specified service does not
 * exist as an installed service», а иногда вместо туннеля открывалось ОКНО WireGuard.
 * Причина не в правах: `wireguard.exe /installtunnelservice` — не автономный
 * туннель, а запрос к службе-менеджеру, которая появляется только при установке
 * стороннего продукта; любой непонятный ему аргумент он понимает как «покажи окно».
 * `wireguard-go.exe` — обычный дочерний процесс без служб и без окон.
 *
 * Системный клиент остался только как ЗАПАСНОЙ вариант для разработчика (в дереве
 * исходников бинарников нет, их раскладывает шаг сборки). В собранном
 * приложении человеку ничего доставать не нужно.
 *
 * Вся ошибкоопасная арифметика (разбор профиля, UAPI, команды маршрутизации,
 * экранирование при повышении прав) живёт в чистых `shared/vpnPlan.ts` и
 * `shared/vpnEmbedded.ts` и закрыта тестами; здесь — только побочные эффекты.
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
import {
  EMBEDDED_DIR,
  embeddedClientName,
  parseUapiHandshake,
  parseWgConfig,
  uapiSocketPath,
} from "../shared/vpnEmbedded";

const run = promisify(execFile);

/* ──────────────────────────── Состояние ─────────────────────────── */

let current: VpnStatePayload = { state: "off", since: null, error: null, backend: null, embedded: true };
/** Куда записан профиль, пока туннель поднят (для снятия и удаления). */
let confPath = "";
/** Способ, которым туннель реально поднят — нужен для симметричного снятия. */
let activeMode: "embedded" | "system" | null = null;
/** Путь к использованному бинарнику (встроенному или системному). */
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

/* ───────────────────── Встроенный клиент ───────────────────── */

/**
 * Каталог, где лежит встроенный клиент.
 *
 * В упакованном приложении — `process.resourcesPath/wireguard` (бинарники
 * кладутся через `extraResources`, а не внутрь asar: внутри архива их нельзя
 * запустить). В режиме разработки — `resources/wireguard/<platform>` в папке
 * приложения: туда их кладёт `npm run vendor:client`.
 */
function embeddedDirs(): string[] {
  const dirs = [join(process.resourcesPath || "", EMBEDDED_DIR)];
  if (!app.isPackaged) {
    dirs.push(join(app.getAppPath(), "resources", EMBEDDED_DIR, process.platform));
    dirs.push(join(app.getAppPath(), "resources", EMBEDDED_DIR));
  }
  return dirs.filter(Boolean);
}

/** Путь к встроенному клиенту для стека, или null, если его в сборке нет. */
function embeddedClientPath(backend: VpnBackend): string | null {
  const name = embeddedClientName(process.platform, backend);
  for (const dir of embeddedDirs()) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Сценарий-работник, поднимающий туннель с правами администратора. Лежит
 * рядом с остальным кодом main-процесса (`dist/main/vpnHelper.js`).
 */
function helperScript(): string {
  return join(__dirname, "vpnHelper.js");
}

/**
 * Запуск работника с правами: нашим же бинарником в режиме Node.
 *
 * `ELECTRON_RUN_AS_NODE=1` превращает исполняемый файл приложения в обычный Node,
 * так что сторонний Node в системе тоже не нужен. Переменная прокидывается
 * через `env`, потому что окно повышения прав не наследует наше окружение.
 */
async function runHelperElevated(args: string[]): Promise<void> {
  const script = helperScript();
  if (!existsSync(script)) throw new Error("Служебная часть встроенного клиента не найдена в сборке");
  const inv = elevatedInvocation(process.platform, process.execPath, [script, ...args], {
    env: { ELECTRON_RUN_AS_NODE: "1" },
  });
  try {
    await run(inv.file, inv.args, { windowsHide: true, timeout: 120_000 });
  } catch (err) {
    throw describeElevationError(err);
  }
}

/** Ошибка повышения прав или самого клиента — человеческим языком. */
function describeElevationError(err: unknown): Error {
  const e = err as { code?: number; stderr?: string; killed?: boolean };
  if (e.killed) return new Error("Команда управления туннелем не завершилась вовремя");
  const stderr = (e.stderr || "").trim();
  /* Отказ в правах — не сбой, а выбор человека: текст об этом и говорит. */
  if (process.platform === "linux" && e.code === 126) {
    return new Error("Не выданы права на поднятие туннеля (запрос отклонён)");
  }
  return new Error(stderr || "Не удалось выполнить команду управления туннелем");
}

/* ───────────────────── Запасной путь: системный клиент ──────────── */

/** Каталоги, где может лежать системный инструмент помимо PATH. */
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

/** Абсолютный путь к системному инструменту или null. */
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

async function runElevated(exe: string, args: string[]): Promise<void> {
  const inv = elevatedInvocation(process.platform, exe, args);
  try {
    await run(inv.file, inv.args, { windowsHide: true, timeout: 120_000 });
  } catch (err) {
    throw describeElevationError(err);
  }
}

/* ──────────────────────── Проверка связи ────────────────────── */

/**
 * Состояние связи у встроенного клиента — читается через его же UAPI-сокет,
 * без утилиты `wg`. Ответ читается под правами пользователя только если ОС
 * разрешает; если нет — считаем туннель поднятым (снять его кнопкой всё
 * равно можно), а не показываем ложную ошибку.
 */
async function embeddedHandshake(): Promise<"fresh" | "silent" | "unknown"> {
  const socketPath = uapiSocketPath(process.platform);
  if (!existsSync(socketPath)) return "unknown";
  try {
    const { connect } = await import("node:net");
    const response = await new Promise<string>((resolve, reject) => {
      const socket = connect(socketPath);
      let out = "";
      socket.setTimeout(5_000);
      socket.on("connect", () => socket.end("get=1\n\n"));
      socket.on("data", (chunk) => {
        out += chunk.toString("utf8");
      });
      socket.on("timeout", () => {
        socket.destroy();
        reject(new Error("timeout"));
      });
      socket.on("error", reject);
      socket.on("close", () => resolve(out));
    });
    const latest = parseUapiHandshake(response);
    if (latest === 0) return "silent";
    return Date.now() / 1000 - latest <= HANDSHAKE_FRESH_SECONDS ? "fresh" : "silent";
  } catch {
    return "unknown";
  }
}

/** Состояние связи у системного клиента (запасной путь разработчика). */
async function systemHandshake(backend: VpnBackend): Promise<"fresh" | "silent" | "unknown"> {
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

function startStatusPolling(backend: VpnBackend, mode: "embedded" | "system"): void {
  stopStatusPolling();
  /* Сколько проверок подряд не увидели связи. Раньше "unknown" (клиент
     не ответил, умер, UAPI недоступен) считалось успехом — именно поэтому в окне
     горело «Соединение активно», пока трафик шёл мимо туннеля. */
  let misses = 0;
  const tick = async () => {
    if (current.state !== "connecting" && current.state !== "on") return;
    const result =
      mode === "embedded" ? await embeddedHandshake() : await systemHandshake(backend);
    if (current.state !== "connecting" && current.state !== "on") return;

    if (result === "fresh") {
      misses = 0;
      if (current.state !== "on") {
        emit({
          state: "on",
          since: current.since ?? new Date().toISOString(),
          error: null,
          backend,
          embedded: mode === "embedded",
        });
      }
      return;
    }

    /* Ни "silent", ни "unknown" больше НЕ включают зелёное состояние: первые
       секунды тишины — норма, но если связи нет дольше, человек обязан это
       видеть, а не доверять зелёной кнопке. */
    misses += 1;
    if (misses < 4) return;
    emit({
      state: "error",
      since: null,
      error:
        "Туннель поднят, но связи с VPN-узлом нет: трафик идёт без защиты. " +
        "Переключите сервер или повторите подключение.",
      backend,
      embedded: mode === "embedded",
    });
    stopStatusPolling();
  };
  void tick();
  statusTimer = setInterval(() => void tick(), 5_000);
}

function stopStatusPolling(): void {
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
}

/* ────────────────────────────── Up / Down ────────────────────────────── */

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
 * Поднять туннель по переданному профилю встроенным клиентом.
 * Идемпотентна для UI: повторный вызов во время подключения ничего не ломает.
 */
export async function vpnUp(config: string): Promise<VpnStatePayload> {
  if (typeof config !== "string" || !looksLikeConfig(config)) {
    emit({ state: "error", since: null, error: "Профиль подключения повреждён", backend: null, embedded: true });
    return current;
  }
  if (current.state === "connecting") return current;

  const obfuscated = isObfuscatedConfig(config);
  const backend: VpnBackend = obfuscated ? "amneziawg" : "wireguard";

  /* Самая частая причина «включил, а не работает» — битый профиль. Лучше
     поймать это до окна повышения прав, чем после. */
  const parsed = parseWgConfig(config);
  if (!parsed.privateKey || parsed.addresses.length === 0 || parsed.peers.length === 0) {
    emit({ state: "error", since: null, error: "Профиль подключения неполон", backend: null, embedded: true });
    return current;
  }

  emit({ state: "connecting", since: null, error: null, backend, embedded: true });

  const embedded = embeddedClientPath(backend);
  try {
    await tearDownQuietly();
    confPath = writeConfFile(config);

    if (embedded) {
      /* Все три системы одинаково: свой работник запускает встроенный клиент и
         настраивает его сам по UAPI. Windows больше не исключение: раньше там
         ставилась служба через `wireguard.exe /installtunnelservice` — и именно она
         требовала службу-менеджер WireGuard и открывала его окно. */
      activeExe = embedded;
      activeMode = "embedded";
      await runHelperElevated(["up", confPath, embedded]);
    } else {
      /* Запасной путь только для дерева исходников без вендоренных бинарников:
         в установленном приложении сюда не попадают. */
      const fallback = await resolveSystemExe(backend);
      if (!fallback) {
        emit({
          state: "error",
          since: null,
          error: "Встроенный клиент отсутствует в этой сборке. Пересоберите приложение с шагом vendor:client.",
          backend: null,
          embedded: false,
        });
        removeConfFile();
        return current;
      }
      activeExe = fallback;
      activeMode = "system";
      await runElevated(fallback, tunnelUpArgs(process.platform, confPath));
    }

    emit({
      state: "connecting",
      since: new Date().toISOString(),
      error: null,
      backend,
      embedded: activeMode === "embedded",
    });
    startStatusPolling(backend, activeMode);
    return current;
  } catch (err) {
    removeConfFile();
    activeExe = "";
    activeMode = null;
    emit({
      state: "error",
      since: null,
      error: err instanceof Error ? err.message : "Не удалось поднять туннель",
      backend: null,
      embedded: true,
    });
    return current;
  }
}

/** Системный инструмент для запасного пути (только режим разработки). */
async function resolveSystemExe(backend: VpnBackend): Promise<string> {
  const obfuscated = backend === "amneziawg";
  for (const candidate of tunnelBackendCandidates(process.platform, obfuscated)) {
    const resolved = await findExecutable(candidate.exe);
    if (resolved) return resolved;
  }
  return "";
}

/** Снять текущий туннель, если он есть, молча (для переустановки/выхода). */
async function tearDownQuietly(): Promise<void> {
  try {
    await tearDown();
  } catch {
    /* нечего снимать — это не ошибка */
  }
}

/**
 * Фактическое снятие туннеля — тем же способом, каким поднимали.
 * Если приложение перезапускалось и память пуста, считаем туннель встроенным:
 * именно так его теперь поднимает приложение.
 */
async function tearDown(): Promise<void> {
  const dir = vpnDir();
  const path = confPath || join(dir, TUNNEL_CONF_FILE);

  if (activeMode === "system") {
    if (!activeExe || !existsSync(path)) return;
    await runElevated(activeExe, tunnelDownArgs(process.platform, path));
    return;
  }

  /* Встроенный клиент: снимает тот же работник, что и поднимал: ему нужно
     убить процесс по PID и убрать правила маршрутизации. */
  if (!existsSync(join(dir, TUNNEL_CONF_FILE)) && !confPath && current.state === "off") return;
  await runHelperElevated(["down", dir]);
}

/** Выключить туннель по кнопке. */
export async function vpnDown(): Promise<VpnStatePayload> {
  if (current.state === "off" || current.state === "disconnecting") {
    stopStatusPolling();
    return current;
  }
  const backend = current.backend;
  emit({ state: "disconnecting", since: current.since, error: null, backend, embedded: activeMode !== "system" });
  stopStatusPolling();
  try {
    await tearDown();
    removeConfFile();
    activeExe = "";
    activeMode = null;
    emit({ state: "off", since: null, error: null, backend: null, embedded: true });
  } catch (err) {
    /* Не удалось снять — честно показываем ошибку, но туннель мог и сняться:
       оставляем прежнее «поднят», чтобы кнопка позволила повторить. */
    emit({
      state: "on",
      since: current.since,
      error: err instanceof Error ? err.message : "Не удалось выключить туннель",
      backend,
      embedded: activeMode !== "system",
    });
  }
  return current;
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
  try {
    await tearDown();
  } catch {
    /* при выходе показывать уже нечего — просто пытаемся не оставить туннель */
  } finally {
    removeConfFile();
    activeExe = "";
    activeMode = null;
  }
}
