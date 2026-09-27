/** TrioZ AmneziaWG lifecycle. The Windows start path stays delegated to the
 * existing AmneziaWG client; physical network handoff is handled separately. */

import { app } from "electron";
import { execFile } from "node:child_process";
import { isIP } from "node:net";
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
} from "./winTunnel";
import { cleanupAfterFailedStart, vpnNeedsCleanup } from "./vpnLifecycle";
import { NetworkHandoff, type PhysicalRoute, type EndpointRoute } from "./networkHandoff";
import { physicalRoute, gatewayReady, gatewayPing, endpointRoutes, resolveEndpoint, changeEndpointRoute, recentAwgHandshake } from "./winNetwork";
import { IPC } from "../shared/constants";
import {
  elevatedInvocation,
  handshakeQuery,
  HANDSHAKE_FRESH_SECONDS,
  parseLatestHandshake,
  TUNNEL_CONF_FILE,
  TUNNEL_NAME,
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
let endpointIp = "";
let ownedRoute: EndpointRoute | null = null;

/** Only routes created by TrioZ are persisted and removed; never delete a stranger's /32. */
function routeRecordPath(): string { return join(vpnDir(), "endpoint-route.json"); }
function readOwnedRoute(): EndpointRoute | null {
  if (ownedRoute) return ownedRoute;
  try {
    const row = JSON.parse(readFileSync(routeRecordPath(), "utf8")) as EndpointRoute;
    if (netIsIPv4(row.ip) && netIsIPv4(row.gateway) && Number.isInteger(row.interfaceIndex) && row.interfaceIndex > 0) return row;
  } catch { /* no record */ }
  return null;
}
function netIsIPv4(value: string): boolean {
  return typeof value === "string" && isIP(value) === 4;
}
async function removeOwnedRoute(): Promise<void> {
  const route = readOwnedRoute();
  if (!route) return;
  await changeEndpointRoute(route, null);
  ownedRoute = null;
  rmSync(routeRecordPath(), { force: true });
  console.info("[VPN] ENDPOINT_ROUTE_REMOVED", route);
}
async function tryRemoveOwnedRoute(): Promise<void> {
  try { await removeOwnedRoute(); }
  catch (err) { console.warn("[VPN] ENDPOINT_ROUTE_REMOVED failed (nonfatal):", err); }
}
function configEndpoint(config: string): string | null {
  return parseWgConfig(config).peers.find((p) => p.endpoint)?.endpoint ?? null;
}
/** Let AmneziaWG install its own exclusion route first; create ours only if none exists. */
async function reconcileEndpointRoute(config: string, route: PhysicalRoute, resolvedIp = ""): Promise<void> {
  const endpoint = configEndpoint(config);
  if (!endpoint) return;
  let ip = resolvedIp;
  if (!ip) {
    try { ip = await resolveEndpoint(endpoint, route); }
    catch (err) { console.warn("[VPN] VPN_ENDPOINT resolve unavailable; AmneziaWG retains control:", err); return; }
  }
  endpointIp = ip;
  console.info("[VPN] VPN_ENDPOINT", ip);
  const existing = await endpointRoutes(ip);
  if (existing.some((r) => r.interfaceIndex === route.interfaceIndex && r.gateway === route.gateway)) {
    console.info("[VPN] Endpoint route provided by AmneziaWG; no change");
    return;
  }
  if (existing.length) {
    // A route not recorded as ours may belong to another application. Do not delete it.
    console.warn("[VPN] Conflicting endpoint /32; refusing to edit unowned route", existing);
    return;
  }
  try {
    const latest = await physicalRoute();
    if (!latest || !await gatewayReady(route)) return;
    const candidate = { ip, interfaceIndex: latest.interfaceIndex, gateway: latest.gateway };
    await changeEndpointRoute(null, candidate);
    ownedRoute = candidate;
    mkdirSync(vpnDir(), { recursive: true, mode: 0o700 });
    writeFileSync(routeRecordPath(), JSON.stringify(candidate), { mode: 0o600 });
    console.info("[VPN] ENDPOINT_ROUTE_CREATED", candidate);
  } catch (err) {
    console.warn("[VPN] Endpoint route fallback failed; leaving AmneziaWG in charge:", err);
  }
}
async function waitForWindowsLink(cancelled: () => boolean): Promise<boolean> {
  const deadline = Date.now() + 25_000;
  while (!cancelled() && Date.now() < deadline) {
    if (await windowsServiceHandshake() === "fresh") return true;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
}
const handoff = new NetworkHandoff({
  physical: physicalRoute,
  ready: gatewayReady,
  active: () => process.platform === "win32" && vpnWanted && !!savedConfig,
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
    // The original start path was functional; do not pre-install a competing /32.
    const oldBase = handoff.getBaseline();
    const oldEndpointRoute = oldBase && endpointIp
      ? (await endpointRoutes(endpointIp)).find((r) => r.interfaceIndex === oldBase.interfaceIndex && r.gateway === oldBase.gateway)
      : null;
    console.info("[VPN] AMNEZIAWG_STOP");
    await windowsTunnelDown(activeExe); // waits STOPPED, PID exit, and TrioZ adapter removal
    await tryRemoveOwnedRoute();
    const fresh = await physicalRoute();
    if (!fresh || !await gatewayReady(fresh)) throw new Error("Физический gateway ещё не готов");
    console.info("[VPN] NEW_INTERFACE", fresh.interfaceAlias, fresh.interfaceIndex,
      "NEW_GATEWAY", fresh.gateway, "gateway ICMP:", await gatewayPing(fresh));
    // The client's own old exclusion may survive a service crash. Remove only
    // the exact /32 we observed on TrioZ's previous uplink, after service exit.
    if (oldEndpointRoute && (oldEndpointRoute.interfaceIndex !== fresh.interfaceIndex ||
        oldEndpointRoute.gateway !== fresh.gateway) &&
        (await endpointRoutes(oldEndpointRoute.ip)).some((r) =>
          r.interfaceIndex === oldEndpointRoute.interfaceIndex && r.gateway === oldEndpointRoute.gateway)) {
      await changeEndpointRoute(oldEndpointRoute, null);
      console.info("[VPN] ENDPOINT_ROUTE_REMOVED", oldEndpointRoute);
    }
    let freshEndpointIp = "";
    const endpoint = configEndpoint(savedConfig);
    if (endpoint) {
      try { freshEndpointIp = await resolveEndpoint(endpoint, fresh); }
      catch (err) { console.warn("[VPN] DNS физического интерфейса недоступен:", err); }
    }
    if (endpointIp) console.info("[VPN] OLD_ENDPOINT_ROUTE", await endpointRoutes(endpointIp));
    if (freshEndpointIp) console.info("[VPN] VPN_ENDPOINT", freshEndpointIp,
      "route before start:", await endpointRoutes(freshEndpointIp));
    if (cancelled()) return false;
    console.info("[VPN] AMNEZIAWG_START");
    activeExe = await windowsTunnelUp(savedConfig, embeddedClientPath("amneziawg"));
    activeMode = "system";
    // Give the existing AmneziaWG route/handshake path priority. A custom /32
    // is a fallback after a failed health probe, never a prerequisite for startup.
    let healthy = await waitForWindowsLink(cancelled);
    if (!healthy && !cancelled()) {
      await reconcileEndpointRoute(savedConfig, fresh, freshEndpointIp);
      healthy = await waitForWindowsLink(cancelled);
    }
    if (cancelled()) return false;
    if (!healthy) throw new Error("Нет входящего трафика VPN-узла после запуска AmneziaWG");
    const tool = activeExe || embeddedClientPath("amneziawg");
    console.info("[VPN] HANDSHAKE_CHECK", tool ? await recentAwgHandshake(tool) : "unavailable",
      "(diagnostic; /dumplog format is not a gate)");
    emit({ state: "on", since: new Date().toISOString(), error: null, backend: "amneziawg", embedded: false });
    startStatusPolling("amneziawg", "system");
    return true;
  },
});
export function startVpnNetworkMonitor(): void {
  if (process.platform !== "win32" || networkTimer) return;
  networkTimer = setInterval(() => {
    void handoff.scan().catch((err) => console.warn("[VPN] NETWORK_CHANGED scan failed:", err));
  }, 3000);
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

/** Windows status: AmneziaWGTunnel$trioz, its adapter, and incoming bytes. */
async function windowsServiceHandshake(): Promise<"fresh" | "silent" | "unknown"> {
  try {
    /* Только собственная AmneziaWG-служба TrioZ. */
    const names = [`AmneziaWGTunnel$${TUNNEL_NAME}`];
    let running = false;
    for (const name of names) {
      try {
        const { stdout } = await run("sc.exe", ["query", name], {
          windowsHide: true,
          timeout: 10_000,
        });
        if (/RUNNING/i.test(stdout)) {
          running = true;
          break;
        }
      } catch {
        /* Службы с таким именем нет — пробуем следующее. */
      }
    }
    if (!running) return "silent";
  } catch {
    return "silent";
  }
  /* Служба жива. Дополнительно убеждаемся, что адаптер в состоянии Up:
     так ловится случай «служба есть, а сетевого устройства нет». */
  try {
    const { stdout } = await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-NetAdapter -Name '${TUNNEL_NAME}' -ErrorAction SilentlyContinue).Status`,
      ],
      { windowsHide: true, timeout: 15_000 },
    );
    /* FIX-WINLINK: живая служба и адаптер Up ещё не значат связь с узлом.
       Спрашиваем счётчик входящих байт: в туннеле они приходят только от
       узла, поэтому ноль — это честное «связи нет», а не «всё хорошо». */
    if (/Up/i.test(stdout)) return await windowsLinkVerdict();
    if (stdout.trim() === "") return "unknown";
    return "silent";
  } catch {
    /* Не смогли проверить адаптер: не показываем ложный connected. */
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
  /* Windows теперь использует официальный wireguard.exe /installtunnelservice.
     Старый служебный компонент TrioZ с vpnHelper/wireguard-go больше не нужен
     для WireGuardNT и намеренно отключён. */
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

  vpnWanted = false;
  await handoff.cancel();
  savedConfig = config;
  endpointIp = "";
  // Capture the uplink concurrently. A slow PowerShell probe must never delay
  // the previously working AmneziaWG /installtunnelservice call.
  const initialPhysicalPromise: Promise<PhysicalRoute | null> = process.platform === "win32"
    ? physicalRoute() : Promise.resolve(null);
  vpnWanted = true;
  emit({ state: "connecting", since: null, error: null, backend, embedded: true });

  const embedded = embeddedClientPath(backend);
  try {
    await cleanupAfterFailedStart(tearDownQuietly);
    if (process.platform === "win32") await tryRemoveOwnedRoute();
    confPath = writeConfFile(config);

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
        /* Рабочий AmneziaWG /installtunnelservice сам создаёт и настраивает
           службу, адаптер, endpoint exclusion и full-tunnel маршруты. */
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
        emit({
          state: "error",
          since: null,
          error: "Встроенный клиент отсутствует в этой сборке. Пересоберите приложение с шагом vendor:client.",
          backend: null,
          embedded: false,
        });
        vpnWanted = false;
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
      embedded: activeMode !== "system",
    });
    void initialPhysicalPromise.then((initialPhysical) => {
      if (!vpnWanted || savedConfig !== config || process.platform !== "win32") return;
      if (initialPhysical) {
        handoff.setBaseline(initialPhysical);
        const initialEndpoint = configEndpoint(config);
        if (initialEndpoint) void resolveEndpoint(initialEndpoint, initialPhysical)
          .then((ip) => { if (vpnWanted && savedConfig === config) endpointIp = ip; })
          .catch((err) => console.info("[VPN] Initial endpoint DNS unavailable:", err));
      } else {
        void physicalRoute().then((latest) => {
          if (latest && vpnWanted && savedConfig === config) handoff.setBaseline(latest);
        });
      }
    });
    startStatusPolling(backend, activeMode);
    return current;
  } catch (err) {
    /* Ошибка могла произойти после создания службы/адаптера. Сначала полностью
       снимаем частично поднятый tunnel тем же lifecycle, и только потом
       очищаем память и возвращаем исходную ошибку пользователю. */
    vpnWanted = false;
    await tearDownQuietly();
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
    if (process.platform === "win32") await tryRemoveOwnedRoute();
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
    if (process.platform === "win32") await tryRemoveOwnedRoute();
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
    if (process.platform === "win32") await tryRemoveOwnedRoute();
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
  vpnWanted = false;
  stopVpnNetworkMonitor();
  await handoff.cancel();
  stopStatusPolling();
  const physicallyActive = process.platform === "win32" && await windowsTunnelExists();
  if (!vpnNeedsCleanup(current.state, physicallyActive)) {
    if (process.platform === "win32") await tryRemoveOwnedRoute();
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

/**
 * Startup recovery after crash/update: only AmneziaWGTunnel$trioz and
 * the exact TrioZ adapter are touched. Other VPN services are not removed.
 */
export async function recoverOrphanedVpn(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  if (!(await windowsTunnelExists())) { await tryRemoveOwnedRoute(); return false; }
  stopStatusPolling();
  try {
    await windowsTunnelDown("");
    await tryRemoveOwnedRoute();
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
