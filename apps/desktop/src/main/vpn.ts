/**
 * TrioZ VPN lifecycle. Windows uses only the bundled/system AmneziaWG client and
 * AmneziaWGTunnel$trioz. A physical uplink monitor rebuilds the owned endpoint
 * host route after gateway/interface/IP changes, then validates the new handshake.
 * Linux/macOS retain their existing AmneziaWG helper path.
 */

import { app } from "electron";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { getMainWindow } from "./mainWindow";
/* FIX-FOREIGNVPN: поиск чужих включённых VPN-адаптеров. */
import { detectForeignTunnels, foreignTunnelMessage } from "./foreignVpn";
import {
  windowsLinkVerdict,
  windowsTunnelDown,
  windowsTunnelExists,
  windowsTunnelUp,
  tunnelServiceRunning, adapterStatus,
} from "./winTunnel";
import { NetworkHandoff, type EndpointRoute, type PhysicalRoute } from "./networkHandoff";
import { physicalRoute, gatewayReady, resolveEndpoint, changeEndpointRoute, endpointRouteValid, recentAwgHandshake } from "./winNetwork";
import { cleanupAfterFailedStart, vpnNeedsCleanup } from "./vpnLifecycle";
import { IPC } from "../shared/constants";
import {
  elevatedInvocation,
  handshakeQuery,
  HANDSHAKE_FRESH_SECONDS,
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
import {
  AGENT_FILE,
  isAgentAlive,
  newRequestId,
  parseHeartbeat,
  parseReport,
  parseStatus,
  REQUEST_FILE,
  reportVerdict,
  serviceDir,
  serviceRequestDir,
  STATUS_FILE,
  TUNNEL_FILE,
  type TunnelAction,
} from "../shared/tunnelService";

const run = promisify(execFile);

/* ──────────────────────────── Состояние ─────────────────────────── */

let current: VpnStatePayload = { state: "off", since: null, error: null, backend: null, embedded: true };
/** Куда записан профиль, пока туннель поднят (для снятия и удаления). */
let confPath = "";
/** Способ, которым туннель реально поднят — нужен для симметричного снятия. */
let activeMode: "embedded" | "system" | "service" | null = null;
/** Путь к использованному бинарнику (встроенному или системному). */
let activeExe = "";
let statusTimer: ReturnType<typeof setInterval> | null = null;
let networkTimer: ReturnType<typeof setInterval> | null = null;
let vpnWanted = false;
let savedConfig = "";
let ownedRoute: EndpointRoute | null = null;
let handshakeSince = 0;

/** Endpoint route metadata is not a secret; keep it so crash cleanup removes only our /32. */
function ownedRoutePath(): string { return join(vpnDir(), "endpoint-route.json"); }
function rememberRoute(route: EndpointRoute | null): void {
  ownedRoute = route;
  try {
    if (route) writeFileSync(ownedRoutePath(), JSON.stringify(route), { mode: 0o600 });
    else rmSync(ownedRoutePath(), { force: true });
  } catch (err) { throw new Error(`Не удалось сохранить состояние endpoint route: ${String(err)}`); }
}
function restoreRoute(): EndpointRoute | null {
  try {
    const value = JSON.parse(readFileSync(ownedRoutePath(), "utf8")) as EndpointRoute;
    return Number.isInteger(value.interfaceIndex) && value.interfaceIndex > 0 &&
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value.ip) ? value : null;
  } catch { return null; }
}
async function clearEndpointRoute(): Promise<void> {
  const previous = ownedRoute || restoreRoute();
  if (!previous) return;
  await changeEndpointRoute(previous, null);
  rememberRoute(null);
  console.info("[VPN] ENDPOINT_ROUTE_REMOVED", previous.ip, previous.interfaceIndex);
}
function endpointFromConfig(config: string): string {
  const endpoint = parseWgConfig(config).peers.find((peer) => peer.endpoint)?.endpoint;
  if (!endpoint) throw new Error("Endpoint отсутствует в профиле AmneziaWG");
  return endpoint;
}
async function installEndpointRoute(config: string, physical: PhysicalRoute): Promise<void> {
  const latest = await physicalRoute();
  if (!latest || latest.interfaceIndex !== physical.interfaceIndex || latest.gateway !== physical.gateway ||
      latest.localAddress !== physical.localAddress) throw new Error("Физический маршрут изменился перед запуском");
  const ip = await resolveEndpoint(endpointFromConfig(config), latest);
  console.info("[VPN] VPN_ENDPOINT", ip);
  await clearEndpointRoute();
  const route = { ip, gateway: latest.gateway, interfaceIndex: latest.interfaceIndex };
  await changeEndpointRoute(null, route); // revalidates /0 and verifies /32 immediately before start
  rememberRoute(route);
  console.info("[VPN] ENDPOINT_ROUTE_CREATED", route);
}
async function verifiedWindowsLink(): Promise<boolean> {
  if (!(await tunnelServiceRunning()) || !/^Up$/i.test(await adapterStatus())) return false;
  if (!ownedRoute) return false;
  const physical = await physicalRoute();
  if (!physical || physical.interfaceIndex !== ownedRoute.interfaceIndex || physical.gateway !== ownedRoute.gateway ||
      !(await endpointRouteValid(ownedRoute))) return false;
  const tool = (await findExecutable("awg.exe")) || activeExe || embeddedClientPath("amneziawg");
  console.info("[VPN] HANDSHAKE_CHECK", tool ? "AmneziaWG log/awg" : "tool unavailable");
  return !!tool && await recentAwgHandshake(tool, handshakeSince) && await windowsLinkVerdict() === "fresh";
}
async function waitForVerifiedLink(cancelled: () => boolean): Promise<boolean> {
  const deadline = Date.now() + 22_000;
  while (!cancelled() && Date.now() < deadline) {
    if (await verifiedWindowsLink()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
}
const handoff = new NetworkHandoff({
  physical: physicalRoute, ready: gatewayReady,
  active: () => vpnWanted && !!savedConfig && process.platform === "win32",
  status: (message, failed) => {
    if (!vpnWanted) return;
    stopStatusPolling();
    emit({ state: failed ? "error" : "connecting", since: failed ? null : current.since,
      error: failed ? message : "VPN: переподключение...", backend: "amneziawg", embedded: false });
  },
  log: (message) => console.info("[VPN]", message),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  recover: async (_route, cancelled) => {
    if (cancelled()) return false;
    // A fresh handshake means the tunnel recovered naturally; still rebuild stale /32.
    if (await verifiedWindowsLink()) {
      await clearEndpointRoute();
      const physical = await physicalRoute();
      if (!physical || !(await gatewayReady(physical))) throw new Error("Новый шлюз пока недоступен");
      await installEndpointRoute(savedConfig, physical);
      if (await verifiedWindowsLink()) {
        emit({ state: "on", since: new Date().toISOString(), error: null, backend: "amneziawg", embedded: false });
        startStatusPolling("amneziawg", "system");
        return true;
      }
    }
    console.info("[VPN] AMNEZIAWG_STOP");
    await windowsTunnelDown(activeExe);
    await clearEndpointRoute();
    const fresh = await physicalRoute();
    if (!fresh || !(await gatewayReady(fresh))) throw new Error("Новый физический шлюз недоступен");
    if (cancelled()) return false;
    await installEndpointRoute(savedConfig, fresh);
    if (cancelled()) return false;
    console.info("[VPN] AMNEZIAWG_START");
    handshakeSince = Date.now();
    const embedded = embeddedClientPath("amneziawg");
    activeExe = await windowsTunnelUp(savedConfig, embedded);
    activeMode = "system";
    const good = await waitForVerifiedLink(cancelled);
    if (cancelled()) return false;
    if (!good) throw new Error("AmneziaWG: handshake не подтверждён после восстановления");
    emit({ state: "on", since: new Date().toISOString(), error: null, backend: "amneziawg", embedded: false });
    startStatusPolling("amneziawg", "system");
    return true;
  },
});
export function startVpnNetworkMonitor(): void {
  if (process.platform !== "win32" || networkTimer) return;
  networkTimer = setInterval(() => { void handoff.scan().catch((err) => console.warn("[VPN] NETWORK_CHANGED scan failed", err)); }, 3000);
}
export function stopVpnNetworkMonitor(): void {
  if (networkTimer) clearInterval(networkTimer);
  networkTimer = null;
}


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

export async function isVpnActive(): Promise<boolean> {
  if (vpnNeedsCleanup(current.state, false)) return true;
  /* Состояние renderer не является источником истины. После ошибки или
     перезапуска служба/адаптер могли физически остаться в Windows. */
  if (process.platform === "win32") return vpnNeedsCleanup(current.state, await windowsTunnelExists());
  return false;
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
    return [
      join(pf, "AmneziaWG"),
      join(pf, "Amnezia", "AmneziaWG"),
    ];
  }
  return ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin", "/sbin", "/usr/sbin", "/run/current-system/sw/bin"];
}

/** Абсолютный путь к системному инструменту или null. */
async function findExecutable(exe: string): Promise<string | null> {
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await run(finder, [exe], { windowsHide: true, timeout: 10_000 });
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
 * без ути��иты `wg`. Ответ читается под правами пользователя только если ОС
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

/** Windows: service, adapter, physical endpoint route and actual AWG handshake. */
async function windowsServiceHandshake(): Promise<"fresh" | "silent" | "unknown"> {
  return await verifiedWindowsLink() ? "fresh" : "silent";
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

/* ──────────── SERVICE-TUNNEL: связь с постоянным компонентом ─────────── */

function serviceFile(name: string): string {
  return join(serviceDir(process.platform, process.env), name);
}

function readServiceFile(name: string): string | null {
  try {
    return readFileSync(serviceFile(name), "utf8");
  } catch {
    return null;
  }
}

/**
 * Есть ли в системе живой служебный компонент. Если его нет (старая сборка,
 * задание удалили вручную, компонент не запустился) — работаем прежним путём,
 * через разовое повышение прав, чтобы не остаться вообще без VPN.
 */
function serviceAvailable(): boolean {
  /* Windows использует AmneziaWG service lifecycle; старый helper отключён. */
  return false;
}

/**
 * Отдать заявку компоненту и дождаться результата. Окна повышения прав здесь
 * нет и быть не может: адаптер создаёт тот, кто уже работает с правами системы.
 */
async function serviceSend(action: TunnelAction, config: string): Promise<void> {
  const id = newRequestId();

  /* FIX-SVC-NONCE: разовое число берётся из свежей отметки компонента. Заявка без
     него не будет выполнена, и ждать две минуты вхолостую незачем. */
  const beat = readServiceFile(AGENT_FILE);
  const heartbeat = beat === null ? null : parseHeartbeat(beat);
  if (!heartbeat || !isAgentAlive(heartbeat, Date.now())) {
    throw new Error(
      "Служебный компонент VPN не отвечает. Перезапустите компьютер или переустановите приложение.",
    );
  }
  if (!heartbeat.nonce) {
    throw new Error(
      "Служебный компонент устарел: переустановите приложение, чтобы обновить его.",
    );
  }

  /* Заявка кладётся в ОТДЕЛЬНЫЙ каталог: каталог состояния теперь закрыт на
     запись всем, кроме системы (FIX-SVC-ACL). */
  const requestDir = serviceRequestDir(process.platform, process.env);
  try {
    mkdirSync(requestDir, { recursive: true });
  } catch {
    /* каталог создаёт установщик; если его нет — запись ниже скажет о этом */
  }
  writeFileSync(
    join(requestDir, REQUEST_FILE),
    JSON.stringify({ id, action, config, nonce: heartbeat.nonce }),
    { mode: 0o600 },
  );

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const raw = readServiceFile(STATUS_FILE);
    const status = raw === null ? null : parseStatus(raw);
    /* Чужой идентификатор — это ответ на прошлую заявку, его нельзя принимать
       за свой: иначе кнопка «включить» мгновенно позеленела бы по старому
       результату. */
    if (!status || status.id !== id) continue;
    if (status.state === "ok") return;
    if (status.state === "error") {
      throw new Error(status.error || "Служебный компонент не смог поднять туннель");
    }
  }
  throw new Error(
    "Служебный компонент VPN не отвечает. Перезапустите компьютер или переустановите приложение.",
  );
}

/**
 * Состояние туннеля в служебном режиме. Спрашивать клиента напрямую нельзя:
 * его канал управления принадлежит системе и обычному пользователю закрыт —
 * поэтому время рукопожатия отдаёт сам компонент.
 */
function serviceHandshake(): "fresh" | "silent" | "unknown" {
  const raw = readServiceFile(TUNNEL_FILE);
  return reportVerdict(raw === null ? null : parseReport(raw), Date.now(), HANDSHAKE_FRESH_SECONDS);
}

function startStatusPolling(
  backend: VpnBackend,
  mode: "embedded" | "system" | "service",
): void {
  stopStatusPolling();
  /* Сколько проверок подряд не увидели связи. Раньше "unknown" (клиент
     не ответил, умер, UAPI недоступен) считалось успехом — именно поэтому в окне
     горело «Соединение активно», пока трафик шёл мимо туннеля. */
  let misses = 0;
  const tick = async () => {
    if (current.state !== "connecting" && current.state !== "on") return;
    const result =
      mode === "service"
        ? serviceHandshake()
        : mode === "embedded"
          ? await embeddedHandshake()
          : process.platform === "win32"
            ? await windowsServiceHandshake()
            : await systemHandshake(backend);
    if (current.state !== "connecting" && current.state !== "on") return;

    if (result === "fresh") {
      misses = 0;
      if (current.state !== "on") {
        emit({
          state: "on",
          since: current.since ?? new Date().toISOString(),
          error: null,
          backend,
          embedded: mode !== "system",
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
      embedded: mode !== "system",
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

  /* FIX-AWG-ONLY: бекенд в проекте один. Раньше здесь выбирался обычный
     WireGuard для профилей без параметров маскировки, но узлы проекта
     поднимают только AmneziaWG, а он справляется и с простым профилем. */
  const backend: VpnBackend = "amneziawg";

  /* Самая частая причина «включил, а не работает» — битый профиль. Лучше
     поймать это до окна повышения прав, чем после. */
  const parsed = parseWgConfig(config);
  if (!parsed.privateKey || parsed.addresses.length === 0 || parsed.peers.length === 0) {
    emit({ state: "error", since: null, error: "Профиль подключения неполон", backend: null, embedded: true });
    return current;
  }

  /* FIX-FOREIGNVPN: два full-tunnel VPN делят один маршрут по умолчанию. Если
     сторонний туннель уже поднят, наш выглядит включённым, а трафик идёт мимо —
     самый запутывающий из возможных исходов. Лучше честно отказать. */
  const foreign = await detectForeignTunnels();
  if (foreign.length > 0) {
    emit({ state: "error", since: null, error: foreignTunnelMessage(foreign), backend: null, embedded: true });
    return current;
  }

  // A manual connect supersedes a failed automatic recovery, never runs in parallel.
  vpnWanted = false;
  await handoff.cancel();
  savedConfig = config;
  vpnWanted = true;
  let initialPhysical: PhysicalRoute | null = null;
  if (process.platform === "win32") {
    initialPhysical = await physicalRoute();
    if (!initialPhysical || !(await gatewayReady(initialPhysical))) {
      vpnWanted = false;
      emit({ state: "error", since: null, error: "Нет доступного физического шлюза для VPN", backend, embedded: false });
      return current;
    }
  }
  emit({ state: "connecting", since: null, error: null, backend, embedded: true });

  const embedded = embeddedClientPath(backend);
  try {
    await cleanupAfterFailedStart(tearDownQuietly);
    confPath = writeConfFile(config);
    if (initialPhysical) {
      await clearEndpointRoute();
      await installEndpointRoute(config, initialPhysical);
    }

    if (serviceAvailable()) {
      /* Обычный путь в установленном приложении. Права администратора спрошены
         один раз, установщиком, поэтому здесь окна UAC нет вообще, а адаптер
         «trioz» появляется в сетевых подключениях как обычное сетевое
         устройство. Заявка несёт только текст профиля: путь к программе
         компонент выбирает сам, иначе любой пользователь машины получил бы
         запуск своего кода с правами системы. */
      activeExe = embedded || "";
      activeMode = "service";
      await serviceSend("up", config);
    } else if (embedded) {
      activeExe = embedded;
      if (process.platform === "win32") {
        /* Только AmneziaWG /installtunnelservice для trioz; физический
           endpoint /32 уже закреплён за реальным интерфейсом выше. */
        /* FIX-WINCLIENT: раньше здесь была одна строка «попросить клиента
           поставить службу» — и всё. У автора проекта это работало только
           потому, что клиент AmneziaWG уже был установлен в системе руками.
           На чистой машине служба создавалась от пути внутри профиля
           пользователя, не находила ни своих библиотек, ни профиля, и падала
           с «Системе не удаётся найти указанный путь» — приложение при этом
           показывало «туннель поднят, связи с узлом нет». Теперь весь этот
           ручной сценарий делает windowsTunnelUp: копирует клиента целиком и
           профиль в общий каталог машины, снимает прежнюю службу и адаптер,
           ставит новую и ждёт подтверждения, что она действительно живёт. */
        activeMode = "system";
        handshakeSince = Date.now();
        activeExe = await windowsTunnelUp(config, embedded);
      } else {
        /* Linux/macOS по-прежнему используют встроенный wireguard-go helper. */
        activeMode = "embedded";
        await runHelperElevated(["up", confPath, embedded]);
      }
    } else {
      /* Запасной путь только для дерева исходников без вендоренных бинарников:
         в установленном приложении сюда не попадают. */
      const fallback = await resolveSystemExe();
      if (!fallback) {
        throw new Error("Встроенный клиент отсутствует в этой сборке. Пересоберите приложение с шагом vendor:client.");
      }
      activeExe = fallback;
      activeMode = "system";
      handshakeSince = Date.now();
      await runElevated(fallback, tunnelUpArgs(process.platform, confPath));
    }

    emit({
      state: "connecting",
      since: new Date().toISOString(),
      error: null,
      backend,
      embedded: activeMode !== "system",
    });
    if (initialPhysical) handoff.setBaseline(initialPhysical);
    startStatusPolling(backend, activeMode);
    return current;
  } catch (err) {
    /* Ошибка могла произойти после создания службы/адаптера. Сначала полностью
       снимаем частично поднятый tunnel тем же lifecycle, и только потом
       очищаем память и возвращаем исходную ошибку пользователю. */
    vpnWanted = false;
    await tearDownQuietly();
    try { await clearEndpointRoute(); } catch (routeError) { console.warn("[VPN] ENDPOINT_ROUTE_REMOVED failed", routeError); }
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
async function resolveSystemExe(): Promise<string> {
  for (const candidate of tunnelBackendCandidates(process.platform)) {
    const resolved = await findExecutable(candidate.exe);
    if (resolved) return resolved;
  }
  return "";
}

/** Снять текущий туннель, если он есть, молча (для переустановки/выхода). */
async function tearDownQuietly(): Promise<void> {
  try {
    await tearDown();
    if (process.platform === "win32") await clearEndpointRoute();
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

  /* Если туннель поднимал компонент, снимать его должен он же: у приложения
     нет прав ни убить процесс клиента, ни убрать маршруты. Пустой activeMode —
     это перезапуск приложения при живом туннеле, и там тоже нужен компонент. */
  if (activeMode === "service" || (activeMode === null && serviceAvailable())) {
    await serviceSend("down", "");
    return;
  }

  if (
    activeMode === "system" ||
    (process.platform === "win32" && await windowsTunnelExists())
  ) {
    /* FIX-WINCLIENT: служба снимается по имени туннеля, а не по файлу профиля.
       Прежняя проверка `existsSync(path)` молча выходила, если профиль уже
       был удалён, и туннель оставался поднятым до перезагрузки. */
    if (process.platform === "win32") {
      await windowsTunnelDown(activeExe);
      return;
    }
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
  vpnWanted = false;
  await handoff.cancel();
  const physicallyActive = process.platform === "win32" && await windowsTunnelExists();
  if (!vpnNeedsCleanup(current.state, physicallyActive)) {
    stopStatusPolling();
    if (process.platform === "win32") await clearEndpointRoute();
    removeConfFile();
    activeExe = "";
    activeMode = null;
    emit({ state: "off", since: null, error: null, backend: null, embedded: true });
    return current;
  }
  if (current.state === "disconnecting") {
    stopStatusPolling();
    return current;
  }
  const backend = current.backend;
  emit({ state: "disconnecting", since: current.since, error: null, backend, embedded: activeMode !== "system" });
  stopStatusPolling();
  try {
    await tearDown();
    if (process.platform === "win32") await clearEndpointRoute();
    removeConfFile();
    activeExe = "";
    activeMode = null;
    emit({ state: "off", since: null, error: null, backend: null, embedded: true });
  } catch (err) {
    /* Не удалось снять — честно показываем ошибку, но туннель мог и сняться:
       оставляем прежнее «поднят», чтобы кнопка позволила повторить. */
    emit({
      state: "error",
      since: null,
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
  vpnWanted = false;
  stopVpnNetworkMonitor();
  await handoff.cancel();
  stopStatusPolling();
  const physicallyActive = process.platform === "win32" && await windowsTunnelExists();
  if (!vpnNeedsCleanup(current.state, physicallyActive)) {
    if (process.platform === "win32") await clearEndpointRoute();
    removeConfFile();
    return;
  }
  try {
    await tearDown();
    if (process.platform === "win32") await clearEndpointRoute();
  } catch (err) {
    console.warn("[VPN] cleanup при выходе не завершён:", err);
  } finally {
    removeConfFile();
    activeExe = "";
    activeMode = null;
  }
}

/**
 * Startup recovery: старая служба могла пережить crash/update, тогда память
 * Electron говорит `off`, а Windows продолжает маршрутизировать через tunnel.
 * Удаляется только AmneziaWGTunnel$trioz и адаптер с точным именем `trioz`.
 */
export async function recoverOrphanedVpn(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  if (!(await windowsTunnelExists())) {
    await clearEndpointRoute();
    return false;
  }
  stopStatusPolling();
  try {
    await windowsTunnelDown("");
    await clearEndpointRoute();
    current = { state: "off", since: null, error: null, backend: null, embedded: true };
    return true;
  } catch (error) {
    current = {
      state: "error",
      since: null,
      error: error instanceof Error ? error.message : "Не удалось очистить старый туннель TrioZ",
      backend: null,
      embedded: true,
    };
    throw error;
  } finally {
    removeConfFile();
    activeExe = "";
    activeMode = null;
  }
}
