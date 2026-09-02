"use strict";
/**
 * VPN-WINDOWS-OFFICIAL: менеджер туннеля.
 *
 * Windows больше не использует самописный бэкенд `wireguard-go + Wintun + netsh`.
 * Вместо него в ресурсы сборки кладётся официальный `wireguard.exe` из проекта
 * wireguard-windows, а включение вызывает:
 *
 *   wireguard.exe /installtunnelservice <путь к trioz.conf>
 *
 * Официальный клиент сам создаёт службу `WireGuardTunnel$trioz`, WireGuardNT-
 * адаптер, назначает адреса/DNS, сохраняет маршрут до endpoint и применяет
 * full-tunnel (`0.0.0.0/1`, `128.0.0.0/1`) тем способом, которым это делает
 * WireGuard for Windows.
 *
 * Linux/macOS пока остаются на прежнем встроенном helper (`wireguard-go` через
 * UAPI), потому что wireguard-windows относится только к Windows.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.vpnState = vpnState;
exports.isVpnActive = isVpnActive;
exports.vpnUp = vpnUp;
exports.vpnDown = vpnDown;
exports.shutdownVpn = shutdownVpn;
const electron_1 = require("electron");
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_util_1 = require("node:util");
const mainWindow_1 = require("./mainWindow");
/* FIX-FOREIGNVPN: поиск чужих включённых VPN-адаптеров. */
const foreignVpn_1 = require("./foreignVpn");
const winTunnel_1 = require("./winTunnel");
const constants_1 = require("../shared/constants");
const vpnPlan_1 = require("../shared/vpnPlan");
const vpnEmbedded_1 = require("../shared/vpnEmbedded");
const tunnelService_1 = require("../shared/tunnelService");
const run = (0, node_util_1.promisify)(node_child_process_1.execFile);
/* ──────────────────────────── Состояние ─────────────────────────── */
let current = { state: "off", since: null, error: null, backend: null, embedded: true };
/** Куда записан профиль, пока туннель поднят (для снятия и удаления). */
let confPath = "";
/** Способ, которым туннель реально поднят — нужен для симметричного снятия. */
let activeMode = null;
/** Путь к использованному бинарнику (встроенному или системному). */
let activeExe = "";
let statusTimer = null;
/** Каталог для временного профиля: приватный ключ не должен лежать в общих temp. */
function vpnDir() {
    return (0, node_path_1.join)(electron_1.app.getPath("userData"), "vpn");
}
function emit(next) {
    current = next;
    (0, mainWindow_1.getMainWindow)()?.webContents.send(constants_1.IPC.VPN_STATE, current);
}
/** Текущее состояние — отдаётся синхронно на запрос renderer при открытии окна. */
function vpnState() {
    return current;
}
function isVpnActive() {
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
function embeddedDirs() {
    const dirs = [(0, node_path_1.join)(process.resourcesPath || "", vpnEmbedded_1.EMBEDDED_DIR)];
    if (!electron_1.app.isPackaged) {
        dirs.push((0, node_path_1.join)(electron_1.app.getAppPath(), "resources", vpnEmbedded_1.EMBEDDED_DIR, process.platform));
        dirs.push((0, node_path_1.join)(electron_1.app.getAppPath(), "resources", vpnEmbedded_1.EMBEDDED_DIR));
    }
    return dirs.filter(Boolean);
}
/** Путь к встроенному клиенту для стека, или null, если его в сборке нет. */
function embeddedClientPath(backend) {
    const name = (0, vpnEmbedded_1.embeddedClientName)(process.platform, backend);
    for (const dir of embeddedDirs()) {
        const candidate = (0, node_path_1.join)(dir, name);
        if ((0, node_fs_1.existsSync)(candidate))
            return candidate;
    }
    return null;
}
/**
 * Сценарий-работник, поднимающий туннель с правами администратора. Лежит
 * рядом с остальным кодом main-процесса (`dist/main/vpnHelper.js`).
 */
function helperScript() {
    return (0, node_path_1.join)(__dirname, "vpnHelper.js");
}
/**
 * Запуск работника с правами: нашим же бинарником в режиме Node.
 *
 * `ELECTRON_RUN_AS_NODE=1` превращает исполняемый файл приложения в обычный Node,
 * так что сторонний Node в системе тоже не нужен. Переменная прокидывается
 * через `env`, потому что окно повышения прав не наследует наше окружение.
 */
async function runHelperElevated(args) {
    const script = helperScript();
    if (!(0, node_fs_1.existsSync)(script))
        throw new Error("Служебная часть встроенного клиента не найдена в сборке");
    const inv = (0, vpnPlan_1.elevatedInvocation)(process.platform, process.execPath, [script, ...args], {
        env: { ELECTRON_RUN_AS_NODE: "1" },
    });
    try {
        await run(inv.file, inv.args, { windowsHide: true, timeout: 120_000 });
    }
    catch (err) {
        throw describeElevationError(err);
    }
}
/** Ошибка повышения прав или самого клиента — человеческим языком. */
function describeElevationError(err) {
    const e = err;
    if (e.killed)
        return new Error("Команда управления туннелем не завершилась вовремя");
    const stderr = (e.stderr || "").trim();
    /* Отказ в правах — не сбой, а выбор человека: текст об этом и говорит. */
    if (process.platform === "linux" && e.code === 126) {
        return new Error("Не выданы права на поднятие туннеля (запрос отклонён)");
    }
    return new Error(stderr || "Не удалось выполнить команду управления туннелем");
}
/* ───────────────────── Запасной путь: системный клиент ──────────── */
/** Каталоги, где может лежать системный инструмент помимо PATH. */
function knownDirs() {
    if (process.platform === "win32") {
        const pf = process.env["ProgramFiles"] || "C:\\Program Files";
        const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
        return [
            (0, node_path_1.join)(pf, "WireGuard"),
            (0, node_path_1.join)(pf, "AmneziaWG"),
            (0, node_path_1.join)(pf, "Amnezia", "AmneziaWG"),
            (0, node_path_1.join)(pf86, "WireGuard"),
        ];
    }
    return ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin", "/sbin", "/usr/sbin", "/run/current-system/sw/bin"];
}
/** Абсолютный путь к системному инструменту или null. */
async function findExecutable(exe) {
    const finder = process.platform === "win32" ? "where" : "which";
    try {
        const { stdout } = await run(finder, [exe]);
        const first = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
        if (first && (0, node_fs_1.existsSync)(first))
            return first;
    }
    catch {
        /* нет в PATH — пробуем известные каталоги ниже */
    }
    for (const dir of knownDirs()) {
        const candidate = (0, node_path_1.join)(dir, exe);
        if ((0, node_fs_1.existsSync)(candidate))
            return candidate;
    }
    return null;
}
async function runElevated(exe, args) {
    const inv = (0, vpnPlan_1.elevatedInvocation)(process.platform, exe, args);
    try {
        await run(inv.file, inv.args, { windowsHide: true, timeout: 120_000 });
    }
    catch (err) {
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
async function embeddedHandshake() {
    const socketPath = (0, vpnEmbedded_1.uapiSocketPath)(process.platform);
    if (!(0, node_fs_1.existsSync)(socketPath))
        return "unknown";
    try {
        const { connect } = await Promise.resolve().then(() => __importStar(require("node:net")));
        const response = await new Promise((resolve, reject) => {
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
        const latest = (0, vpnEmbedded_1.parseUapiHandshake)(response);
        if (latest === 0)
            return "silent";
        return Date.now() / 1000 - latest <= vpnPlan_1.HANDSHAKE_FRESH_SECONDS ? "fresh" : "silent";
    }
    catch {
        return "unknown";
    }
}
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
async function windowsServiceHandshake() {
    try {
        /* FIX-AWG-ONLY: имя службы зависит от клиента: форк AmneziaWG регистрирует
           AmneziaWGTunnel$<имя>. Проверяем оба имени, а не одно: привязка к одному
           имени давала бы ложное «туннель не поднят» на работающем туннеле — тот самый
           сорт ошибки, из-за которой приложение раньше ругалось на исправный узел. */
        const names = [`AmneziaWGTunnel$${vpnPlan_1.TUNNEL_NAME}`, `WireGuardTunnel$${vpnPlan_1.TUNNEL_NAME}`];
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
            }
            catch {
                /* Службы с таким именем нет — пробуем следующее. */
            }
        }
        if (!running)
            return "silent";
    }
    catch {
        return "silent";
    }
    /* Служба жива. Дополнительно убеждаемся, что адаптер в состоянии Up:
       так ловится случай «служба есть, а сетевого устройства нет». */
    try {
        const { stdout } = await run("powershell.exe", [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `(Get-NetAdapter -Name '${vpnPlan_1.TUNNEL_NAME}' -ErrorAction SilentlyContinue).Status`,
        ], { windowsHide: true, timeout: 15_000 });
        /* FIX-WINLINK: живая служба и адаптер Up ещё не значат связь с узлом.
           Спрашиваем счётчик входящих байт: в туннеле они приходят только от
           узла, поэтому ноль — это честное «связи нет», а не «всё хорошо». */
        if (/Up/i.test(stdout))
            return await (0, winTunnel_1.windowsLinkVerdict)();
        if (stdout.trim() === "")
            return "unknown";
        return "silent";
    }
    catch {
        /* Не смогли спросить адаптер, но служба работает — считаем туннель живым. */
        return "fresh";
    }
}
/** Состояние связи у системного клиента (запасной путь разработчика). */
async function systemHandshake(backend) {
    const q = (0, vpnPlan_1.handshakeQuery)(process.platform, backend);
    const exe = (await findExecutable(q.exe)) || q.exe;
    try {
        const { stdout } = await run(exe, q.args, { windowsHide: true, timeout: 10_000 });
        const latest = (0, vpnPlan_1.parseLatestHandshake)(stdout);
        if (latest === 0)
            return "silent";
        return Date.now() / 1000 - latest <= vpnPlan_1.HANDSHAKE_FRESH_SECONDS ? "fresh" : "silent";
    }
    catch {
        return "unknown";
    }
}
/* ──────────── SERVICE-TUNNEL: связь с постоянным компонентом ─────────── */
function serviceFile(name) {
    return (0, node_path_1.join)((0, tunnelService_1.serviceDir)(process.platform, process.env), name);
}
function readServiceFile(name) {
    try {
        return (0, node_fs_1.readFileSync)(serviceFile(name), "utf8");
    }
    catch {
        return null;
    }
}
/**
 * Есть ли в системе живой служебный компонент. Если его нет (старая сборка,
 * задание удалили вручную, компонент не запустился) — работаем прежним путём,
 * через разовое повышение прав, чтобы не остаться вообще без VPN.
 */
function serviceAvailable() {
    /* Windows теперь использует официальный wireguard.exe /installtunnelservice.
       Старый служебный компонент TrioZ с vpnHelper/wireguard-go больше не нужен
       для WireGuardNT и намеренно отключён. */
    return false;
}
/**
 * Отдать заявку компоненту и дождаться результата. Окна повышения прав здесь
 * нет и быть не может: адаптер создаёт тот, кто уже работает с правами системы.
 */
async function serviceSend(action, config) {
    const id = (0, tunnelService_1.newRequestId)();
    /* FIX-SVC-NONCE: разовое число берётся из свежей отметки компонента. Заявка без
       него не будет выполнена, и ждать две минуты вхолостую незачем. */
    const beat = readServiceFile(tunnelService_1.AGENT_FILE);
    const heartbeat = beat === null ? null : (0, tunnelService_1.parseHeartbeat)(beat);
    if (!heartbeat || !(0, tunnelService_1.isAgentAlive)(heartbeat, Date.now())) {
        throw new Error("Служебный компонент VPN не отвечает. Перезапустите компьютер или переустановите приложение.");
    }
    if (!heartbeat.nonce) {
        throw new Error("Служебный компонент устарел: переустановите приложение, чтобы обновить его.");
    }
    /* Заявка кладётся в ОТДЕЛЬНЫЙ каталог: каталог состояния теперь закрыт на
       запись всем, кроме системы (FIX-SVC-ACL). */
    const requestDir = (0, tunnelService_1.serviceRequestDir)(process.platform, process.env);
    try {
        (0, node_fs_1.mkdirSync)(requestDir, { recursive: true });
    }
    catch {
        /* каталог создаёт установщик; если его нет — запись ниже скажет о этом */
    }
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(requestDir, tunnelService_1.REQUEST_FILE), JSON.stringify({ id, action, config, nonce: heartbeat.nonce }), { mode: 0o600 });
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const raw = readServiceFile(tunnelService_1.STATUS_FILE);
        const status = raw === null ? null : (0, tunnelService_1.parseStatus)(raw);
        /* Чужой идентификатор — это ответ на прошлую заявку, его нельзя принимать
           за свой: иначе кнопка «включить» мгновенно позеленела бы по старому
           результату. */
        if (!status || status.id !== id)
            continue;
        if (status.state === "ok")
            return;
        if (status.state === "error") {
            throw new Error(status.error || "Служебный компонент не смог поднять туннель");
        }
    }
    throw new Error("Служебный компонент VPN не отвечает. Перезапустите компьютер или переустановите приложение.");
}
/**
 * Состояние туннеля в служебном режиме. Спрашивать клиента напрямую нельзя:
 * его канал управления принадлежит системе и обычному пользователю закрыт —
 * поэтому время рукопожатия отдаёт сам компонент.
 */
function serviceHandshake() {
    const raw = readServiceFile(tunnelService_1.TUNNEL_FILE);
    return (0, tunnelService_1.reportVerdict)(raw === null ? null : (0, tunnelService_1.parseReport)(raw), Date.now(), vpnPlan_1.HANDSHAKE_FRESH_SECONDS);
}
function startStatusPolling(backend, mode) {
    stopStatusPolling();
    /* Сколько проверок подряд не увидели связи. Раньше "unknown" (клиент
       не ответил, умер, UAPI недоступен) считалось успехом — именно поэтому в окне
       горело «Соединение активно», пока трафик шёл мимо туннеля. */
    let misses = 0;
    const tick = async () => {
        if (current.state !== "connecting" && current.state !== "on")
            return;
        const result = mode === "service"
            ? serviceHandshake()
            : mode === "embedded"
                ? await embeddedHandshake()
                : process.platform === "win32"
                    ? await windowsServiceHandshake()
                    : await systemHandshake(backend);
        if (current.state !== "connecting" && current.state !== "on")
            return;
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
        if (misses < 4)
            return;
        emit({
            state: "error",
            since: null,
            error: "Туннель поднят, но связи с VPN-узлом нет: трафик идёт без защиты. " +
                "Переключите сервер или повторите подключение.",
            backend,
            embedded: mode !== "system",
        });
        stopStatusPolling();
    };
    void tick();
    statusTimer = setInterval(() => void tick(), 5_000);
}
function stopStatusPolling() {
    if (statusTimer) {
        clearInterval(statusTimer);
        statusTimer = null;
    }
}
/* ────────────────────────────── Up / Down ────────────────────────────── */
/** Лёгкая проверка, что нам передали именно профиль WireGuard, а не мусор. */
function looksLikeConfig(config) {
    return /\[Interface\]/i.test(config) && /(^|\n)\s*PrivateKey\s*=/i.test(config);
}
function writeConfFile(config) {
    const dir = vpnDir();
    (0, node_fs_1.mkdirSync)(dir, { recursive: true, mode: 0o700 });
    try {
        (0, node_fs_1.chmodSync)(dir, 0o700);
    }
    catch {
        /* Windows игнорирует POSIX-права — там каталог закрыт ACL профиля пользователя. */
    }
    const path = (0, node_path_1.join)(dir, vpnPlan_1.TUNNEL_CONF_FILE);
    (0, node_fs_1.writeFileSync)(path, config.endsWith("\n") ? config : `${config}\n`, { mode: 0o600 });
    try {
        (0, node_fs_1.chmodSync)(path, 0o600);
    }
    catch {
        /* см. выше */
    }
    return path;
}
function removeConfFile() {
    if (!confPath)
        return;
    try {
        (0, node_fs_1.rmSync)(confPath, { force: true });
    }
    catch {
        /* файл мог уже исчезнуть — не мешает выключению */
    }
    confPath = "";
}
/**
 * Поднять туннель по переданному профилю встроенным клиентом.
 * Идемпотентна для UI: повторный вызов во время подключения ничего не ломает.
 */
async function vpnUp(config) {
    if (typeof config !== "string" || !looksLikeConfig(config)) {
        emit({ state: "error", since: null, error: "Профиль подключения повреждён", backend: null, embedded: true });
        return current;
    }
    if (current.state === "connecting")
        return current;
    /* FIX-AWG-ONLY: бекенд в проекте один. Раньше здесь выбирался обычный
       WireGuard для профилей без параметров маскировки, но узлы проекта
       поднимают только AmneziaWG, а он справляется и с простым профилем. */
    const backend = "amneziawg";
    /* Самая частая причина «включил, а не работает» — битый профиль. Лучше
       поймать это до окна повышения прав, чем после. */
    const parsed = (0, vpnEmbedded_1.parseWgConfig)(config);
    if (!parsed.privateKey || parsed.addresses.length === 0 || parsed.peers.length === 0) {
        emit({ state: "error", since: null, error: "Профиль подключения неполон", backend: null, embedded: true });
        return current;
    }
    /* FIX-FOREIGNVPN: два full-tunnel VPN делят один маршрут по умолчанию. Если
       сторонний туннель уже поднят, наш выглядит включённым, а трафик идёт мимо —
       самый запутывающий из возможных исходов. Лучше честно отказать. */
    const foreign = await (0, foreignVpn_1.detectForeignTunnels)();
    if (foreign.length > 0) {
        emit({ state: "error", since: null, error: (0, foreignVpn_1.foreignTunnelMessage)(foreign), backend: null, embedded: true });
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
        }
        else if (embedded) {
            activeExe = embedded;
            if (process.platform === "win32") {
                /* На Windows больше не поднимаем wireguard-go + Wintun своим кодом.
                   Используем официальный wireguard-windows: /installtunnelservice сам
                   создаёт службу WireGuardTunnel$trioz, WireGuardNT-адаптер, адреса,
                   DNS, endpoint-exclude и full-tunnel маршруты. */
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
                activeExe = await (0, winTunnel_1.windowsTunnelUp)(config, embedded);
            }
            else {
                /* Linux/macOS по-прежнему используют встроенный wireguard-go helper. */
                activeMode = "embedded";
                await runHelperElevated(["up", confPath, embedded]);
            }
        }
        else {
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
                removeConfFile();
                return current;
            }
            activeExe = fallback;
            activeMode = "system";
            await runElevated(fallback, (0, vpnPlan_1.tunnelUpArgs)(process.platform, confPath));
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
    }
    catch (err) {
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
async function resolveSystemExe() {
    for (const candidate of (0, vpnPlan_1.tunnelBackendCandidates)(process.platform)) {
        const resolved = await findExecutable(candidate.exe);
        if (resolved)
            return resolved;
    }
    return "";
}
/** Снять текущий туннель, если он есть, молча (для переустановки/выхода). */
async function tearDownQuietly() {
    try {
        await tearDown();
    }
    catch {
        /* нечего снимать — это не ошибка */
    }
}
/**
 * Фактическое снятие туннеля — тем же способом, каким поднимали.
 * Если приложение перезапускалось и память пуста, считаем туннель встроенным:
 * именно так его теперь поднимает приложение.
 */
async function tearDown() {
    const dir = vpnDir();
    const path = confPath || (0, node_path_1.join)(dir, vpnPlan_1.TUNNEL_CONF_FILE);
    /* Если туннель поднимал компонент, снимать его должен он же: у приложения
       нет прав ни убить процесс клиента, ни убрать маршруты. Пустой activeMode —
       это перезапуск приложения при живом туннеле, и там тоже нужен компонент. */
    if (activeMode === "service" || (activeMode === null && serviceAvailable())) {
        await serviceSend("down", "");
        return;
    }
    if (activeMode === "system") {
        /* FIX-WINCLIENT: служба снимается по имени туннеля, а не по файлу профиля.
           Прежняя проверка `existsSync(path)` молча выходила, если профиль уже
           был удалён, и туннель оставался поднятым до перезагрузки. */
        if (process.platform === "win32") {
            await (0, winTunnel_1.windowsTunnelDown)(activeExe);
            return;
        }
        if (!activeExe || !(0, node_fs_1.existsSync)(path))
            return;
        await runElevated(activeExe, (0, vpnPlan_1.tunnelDownArgs)(process.platform, path));
        return;
    }
    /* Встроенный клиент: снимает тот же работник, что и поднимал: ему нужно
       убить процесс по PID и убрать правила маршрутизации. */
    if (!(0, node_fs_1.existsSync)((0, node_path_1.join)(dir, vpnPlan_1.TUNNEL_CONF_FILE)) && !confPath && current.state === "off")
        return;
    await runHelperElevated(["down", dir]);
}
/** Выключить туннель по кнопке. */
async function vpnDown() {
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
    }
    catch (err) {
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
async function shutdownVpn() {
    stopStatusPolling();
    if (current.state === "off") {
        removeConfFile();
        return;
    }
    try {
        await tearDown();
    }
    catch {
        /* при выходе показывать уже нечего — просто пытаемся не оставить туннель */
    }
    finally {
        removeConfFile();
        activeExe = "";
        activeMode = null;
    }
}
//# sourceMappingURL=vpn.js.map