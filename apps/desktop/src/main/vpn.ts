/**
 * VPN-AWG-ONLY: менеджер туннеля AmneziaWG.
 *
 * В проекте остался ОДИН стек — AmneziaWG. Обычный WireGuard убран целиком:
 * узлы поднимают awg0 с маскировкой (Jc/S1/H1…) и обычное рукопожатие МОЛЧА
 * отбрасывают — для человека это выглядит как «включил, а интернета нет».
 * Держать второй вариант поэтому бессмысленно и вредно.
 *
 * Включение — одна команда клиента AmneziaWG:
 *
 *   Windows:      amneziawg.exe /installtunnelservice <путь к trioz.conf>
 *   Linux/macOS:  awg-quick up <путь к trioz.conf>
 *
 * Клиент сам создаёт адаптер, назначает адреса и DNS, сохраняет маршрут до
 * endpoint и кладёт full-tunnel через 0.0.0.0/1 и 128.0.0.0/1, а при снятии
 * возвращает маршруты и DNS как было. Своего кода для поднятия адаптера
 * больше нет: самописный бэкенд «wireguard-go + Wintun + netsh» (файлы
 * `vpnHelper.ts`, `tunnelAgent.ts`, `vpnEmbedded.ts`) удалён — именно он был
 * источником неработающего режима «Весь интернет».
 */

import { app } from "electron";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { getMainWindow } from "./mainWindow";
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
import { EMBEDDED_DIR, embeddedClientName, parseWgConfig } from "../shared/vpnProfile";

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
let activeMode: "system" | "service" | null = null;
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
 * WINDOWS-STATUS: состояние туннеля у официального WireGuard for Windows.
 *
 * Почему не `wg show`: на Windows канал управления туннеля принадлежит
 * службе и закрыт обычному пользователю, а самого `wg.exe` в сборке нет.
 * Раньше это давало ЛОЖНУЮ ошибку «туннель поднят, но связи нет»: вызов
 * `wg` просто не удавался, и проверка считала это отсутствием рукопожатия.
 *
 * Поэтому смотрим на то, что доступно без прав: жива ли служба
 * `WireGuardTunnel$trioz` и поднят ли её адаптер. Служба сама останавливается,
 * если профиль неверный или адаптер не создался.
 */
async function windowsServiceHandshake(): Promise<"fresh" | "silent" | "unknown"> {
  try {
    /* FIX-AWG-ONLY: имя службы зависит от клиента: форк AmneziaWG регистрирует
       AmneziaWGTunnel$<имя>. Проверяем оба имени, а не одно: привязка к одному
       имени давала бы ложное «туннель не поднят» на работающем туннеле — тот самый
       сорт ошибки, из-за которой приложение раньше ругалось на исправный узел. */
    const names = [`AmneziaWGTunnel$${TUNNEL_NAME}`, `WireGuardTunnel$${TUNNEL_NAME}`];
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
    if (/Up/i.test(stdout)) return "fresh";
    if (stdout.trim() === "") return "unknown";
    return "silent";
  } catch {
    /* Не смогли спросить адаптер, но служба работает — считаем туннель живым. */
    return "fresh";
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
     Старый служебный компонент TrioZ с самописным туннелем больше не нужен
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

function startStatusPolling(backend: VpnBackend, mode: "system" | "service"): void {
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

  /* FIX-AWG-ONLY: стек больше не выбирается по содержимому профиля. Прежде
     профиль без строк Jc/S1/H1 считался «обычным» и поднимался обычным
     WireGuard — на маскированном узле такой туннель молча не ходил. Узлы
     проекта всегда маскированные, значит и клиент всегда один. */
  const backend: VpnBackend = "amneziawg";

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
    } else {
      /* FIX-WINCLIENT: на Windows приоритет у УСТАНОВЛЕННОГО клиента AmneziaWG,
         а не у вендоренного. В resources лежит один amneziawg.exe без своего
         каталога данных, и служба AmneziaWGTunnel$trioz падала в цикле с
         «Системе не удается найти указанный путь»: адаптер не создавался, а в
         окне горело «туннель поднят, связи нет». Установленный клиент из
         C:\Program Files\AmneziaWG тот же самый туннель поднимает штатно. */
      const system = await resolveSystemExe(backend);
      const exe = process.platform === "win32" ? system || embedded : embedded || system;
      if (!exe) {
        emit({
          state: "error",
          since: null,
          error:
            "Клиент AmneziaWG не найден. Установите AmneziaWG или пересоберите приложение с шагом vendor:client.",
          backend: null,
          embedded: false,
        });
        removeConfFile();
        return current;
      }
      activeExe = exe;
      activeMode = "system";
      await runElevated(exe, tunnelUpArgs(process.platform, confPath));
    }

    emit({
      state: "connecting",
      since: new Date().toISOString(),
      error: null,
      backend,
      embedded: activeMode !== "system",
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
async function resolveSystemExe(_backend: VpnBackend): Promise<string> {
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

  /* Снимает тот же клиент, что и поднимал: на Windows — снятие службы
     /uninstalltunnelservice, на Linux — awg-quick down. Своего уборщика маршрутов
     больше нет и не нужно: клиент сам возвращает маршруты и DNS как было. */
  if (!activeExe || !existsSync(path)) return;
  await runElevated(activeExe, tunnelDownArgs(process.platform, path));
  return;
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
