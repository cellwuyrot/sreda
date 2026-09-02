"use strict";
/**
 * VPN-EMBEDDED: работник, который поднимает туннель встроенным клиентом.
 *
 * Это единственная часть оболочки, которая работает с правами администратора, и
 * потому она вынесена в ОТДЕЛЬНЫЙ файл, а не живёт в main-процессе: с правами
 * root запускается ровно этот сценарий и ничего больше — ни Chromium, ни окон, ни
 * сетевых запросов к сайту.
 *
 * Запускается собственным бинарником приложения в режиме Node
 * (`ELECTRON_RUN_AS_NODE=1`), поэтому сторонний Node в системе не нужен тоже:
 * скачивать пользователю нечего ни на одном шаге.
 *
 * Вызов:
 *   <exe> <этот-файл> up   <путь-к-профилю> <путь-к-клиенту>
 *   <exe> <этот-файл> down
 *
 * Почему не держим процесс клиента дочерним к main-процессу: окно может
 * перезапуститься (обновление, авария), и туннель в режиме «весь трафик» умер бы
 * вместе с ним, оборвав сеть посередине работы. Клиент живёт сам, его PID
 * лежит рядом с профилем, и любой следующий запуск оболочки способен его снять.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IFACE_FILE = exports.EXCLUDE_FILE = exports.SETUP_LOG = exports.CLIENT_LOG = exports.PID_FILE = void 0;
exports.decodeConsole = decodeConsole;
const node_child_process_1 = require("node:child_process");
const node_dgram_1 = require("node:dgram");
const promises_1 = require("node:dns/promises");
const node_net_1 = require("node:net");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const vpnPlan_1 = require("../shared/vpnPlan");
const vpnEmbedded_1 = require("../shared/vpnEmbedded");
/** Файл с PID запущенного клиента — лежит рядом с профилем. */
exports.PID_FILE = `${vpnPlan_1.TUNNEL_NAME}.pid`;
function fail(message) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
}
/**
 * FIX-NOROUTE: аварийная уборка при любом неудавшемся подъёме.
 *
 * Неудавшееся подключение не имеет права оставлять после себя ни маршрутов,
 * ни адаптера, ни живого клиента: именно так человек оставался без интернета
 * после одной неудачной попытки. Уборка повешена на выход процесса, а не на
 * try/catch, потому что отказ сообщается через fail() из любой точки сценария.
 */
let rollbackDir = null;
let tunnelReady = false;
process.on("exit", (code) => {
    if (code === 0 || tunnelReady || rollbackDir === null)
        return;
    try {
        down(rollbackDir, true);
    }
    catch {
        /* уборка «по возможности»: терять причину отказа из-за неё нельзя */
    }
});
/**
 * Отказы, которые отказами не являются: настройка уже стоит ровно такая, какую
 * мы просим. Повторный `add route` после неудачной попытки — обычное дело.
 */
/**
 * FIX-OEM: верхняя половина кодовой страницы 866 — того, в чём говорят системные
 * утилиты Windows (netsh, route). Нужна ровно для того, чтобы в журнале и в
 * сообщении об ошибке был текст, а не «□□□□□□□ □□ □□□□□□».
 *
 * Именно в таком виде пользователь и получал главную улику: строки
 * «[trioz] шаг пропущен: netsh … -> ������� �� ������» вместо «Элемент не найден».
 * Декодер зашит таблицей, а не вызовом `chcp`: менять кодовую страницу консоли
 * из-под служебного процесса ненадёжно и побочно влияет на всё окружение.
 */
const CP866_HIGH = "АБВГДЕЖЗИЙКЛМНОП" +
    "РСТУФХЦЧШЩЪЫЬЭЮЯ" +
    "абвгдежзийклмноп" +
    "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐" +
    "└┴┬├─┼╞╟╚╔╩╦╠═╬╧" +
    "╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀" +
    "рстуфхцчшщъыьэюя" +
    "ЁёЄєЇїЎў°∙·√№¤■ ";
/** Вывод системной утилиты в читаемом виде. */
function decodeConsole(chunk, platform = process.platform) {
    if (chunk === null || chunk === undefined)
        return "";
    if (typeof chunk === "string")
        return chunk;
    if (platform !== "win32")
        return chunk.toString("utf8");
    let out = "";
    for (const byte of chunk) {
        out += byte < 0x80 ? String.fromCharCode(byte) : (CP866_HIGH[byte - 0x80] ?? "?");
    }
    return out;
}
const HARMLESS_TOOL_ERRORS = [
    "already exists",
    "object already",
    "уже существует",
    "element not found",
    "элемент не найден",
];
/**
 * Запуск штатной утилиты ОС. `required: false` — неуспех допустим.
 *
 * FIX-NETSHDIAG: `netsh` пишет причину отказа в СТАНДАРТНЫЙ ВЫВОД, а не в поток
 * ошибок. Раньше читался только `stderr` — он всегда пуст, поэтому любая беда
 * выглядела одинаково: «неизвестная ошибка», без имени команды и без кода
 * возврата. Разобраться по такому сообщению нельзя ни пользователю, ни нам.
 * Теперь в текст попадают сама команда, ответ утилиты и код выхода.
 */
function runTool(command, required) {
    const [file, ...args] = command;
    if (!file)
        return true;
    /* FIX-OEM: без явного encoding получаем байты и сами переводим их из консольной
       кодовой страницы. С encoding: "utf8" ответ netsh превращался в мусор, и
       единственная важная часть сообщения была нечитаемой. */
    const result = (0, node_child_process_1.spawnSync)(file, args, { timeout: 20_000 });
    const text = `${decodeConsole(result.stdout)} ${decodeConsole(result.stderr)}`.replace(/\s+/g, " ").trim();
    /* FIX-SETUPLOG: в журнал попадает КАЖДЫЙ шаг, а не только упавший. Разбор
       этой поломки занял часы ровно потому, что успешные шаги были невидимы, и
       нельзя было понять, что и в каком порядке реально применилось. */
    logSetup(`${file} ${args.join(" ")} -> код ${result.status ?? "?"}${text ? ` | ${text}` : ""}`);
    if (!result.error && result.status === 0)
        return true;
    const lower = text.toLowerCase();
    if (HARMLESS_TOOL_ERRORS.some((phrase) => lower.includes(phrase)))
        return true;
    const shown = `${file} ${args.join(" ")}`.trim();
    const detail = text || result.error?.message || `код возврата ${result.status ?? "?"}`;
    if (!required) {
        /* Необязательный шаг: пишем в журнал и идём дальше. Ронять рабочий туннель
           из-за него нельзя — см. isCriticalStep. */
        process.stderr.write(`[trioz] шаг пропущен: ${shown} -> ${detail}\n`);
        return false;
    }
    fail(`Не удалось настроить сетевой интерфейс: ${shown} -> ${detail}`);
    return false;
}
/**
 * FIX-NETSH6: какие шаги настройки действительно обязательны.
 *
 * Прежде в Windows обязательными считались ВСЕ шаги подряд. Из-за этого
 * подключение падало на настройке IPv6 у людей, у которых стек IPv6 отключён
 * (реестр `DisabledComponents`, «оптимизаторы», корпоративные политики) или
 * выключен на самом адаптере: `netsh interface ipv6 …` там отвечает отказом,
 * причём в стандартный вывод — то есть с пустым `stderr`. Ровно это и давало
 * «Не удалось настроить сетевой интерфейс (netsh): неизвестная ошибка».
 *
 * Отсутствие IPv6 не создаёт утечки: если стека нет, утекать по нему нечему.
 * Поэтому шаги IPv6 и назначение сервера имён — необязательные (с записью в
 * журнал), а обязательны только адрес IPv4 и маршруты IPv4.
 */
function isCriticalStep(command) {
    if (process.platform !== "win32") {
        return command.includes("address") || command.includes("inet") || command.includes("up");
    }
    if (command.includes("ipv6"))
        return false;
    if (command.includes("dnsservers"))
        return false;
    /* FIX-DAD: тонкая настройка интерфейса — необязательный шаг. На системах, где
       этих параметров нет, отказ не должен отбирать рабочий туннель. */
    if (command.some((part) => part.startsWith("dadtransmits") || part.startsWith("routerdiscovery"))) {
        return false;
    }
    return true;
}
/**
 * Можно ли уже подключиться к UAPI.
 *
 * Проверяем ИМЕННО подключением, а не наличием файла: в Windows UAPI —
 * это именованный канал, который в файловой системе не виден, и проверка
 * `existsSync` всегда говорила бы «нет».
 */
function canConnect(path) {
    return new Promise((resolve) => {
        const socket = (0, node_net_1.connect)(path);
        const finish = (ok) => {
            socket.destroy();
            resolve(ok);
        };
        socket.setTimeout(2_000);
        socket.on("connect", () => finish(true));
        socket.on("error", () => finish(false));
        socket.on("timeout", () => finish(false));
    });
}
/**
 * Дождаться UAPI клиента. Клиент открывает его не мгновенно: сначала
 * поднимает сетевое устройство. Без ожидания настройка улетела бы в пустоту, и
 * туннель поднялся бы без ключей — то есть молча не работал.
 */
async function waitForUapi(path, timeoutMs, logPath, exited) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await canConnect(path))
            return;
        /* FIX-WINTUN: если клиент уже умер, ждать дальше бессмысленно — причина
           написана в его журнале, и человеку нужно показать именно её. */
        const code = exited();
        if (code !== null) {
            const tail = clientLogTail(logPath);
            fail(`Встроенный клиент не смог создать сетевой адаптер (код ${code}).` +
                (tail ? ` Клиент сообщает: ${tail}` : "") +
                ` Полный журнал: ${logPath}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const tail = clientLogTail(logPath);
    fail("Встроенный клиент не успел поднять сетевое устройство." +
        (tail ? ` Клиент сообщает: ${tail}` : "") +
        ` Полный журнал: ${logPath}`);
}
/** Отправить UAPI-запрос и вернуть ответ целиком. */
function uapiRequest(path, payload) {
    return new Promise((resolve, reject) => {
        const socket = (0, node_net_1.connect)(path);
        let out = "";
        socket.setTimeout(10_000);
        socket.on("connect", () => socket.end(payload));
        socket.on("data", (chunk) => {
            out += chunk.toString("utf8");
        });
        socket.on("timeout", () => {
            socket.destroy();
            reject(new Error("Встроенный клиент не ответил на настройку"));
        });
        socket.on("error", reject);
        socket.on("close", () => resolve(out));
    });
}
/** Ответ UAPI: строка `errno=0` означает успех, любое другое число — отказ. */
function assertUapiOk(response) {
    const match = /errno=(-?\d+)/.exec(response);
    if (!match || match[1] === "0")
        return;
    fail(`Встроенный клиент отклонил настройки подключения (код ${match[1]})`);
}
/**
 * Дождаться РЕАЛЬНОГО рукопожатия с узлом.
 *
 * Без этой проверки работник сообщал «ok» сразу после настройки интерфейса —
 * ещё до того, как стало известно, ответил ли сервер вообще. Именно так
 * появлялось самое вредное состояние: в окне «Соединение активно», а трафик идёт
 * мимо туннеля, и внешние проверки показывают прежний адрес.
 */
async function waitForHandshake(path, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            if ((0, vpnEmbedded_1.parseUapiHandshake)(await uapiRequest(path, "get=1\n\n")) > 0)
                return;
        }
        catch {
            /* клиент занят — спросим ещё раз */
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    fail("Туннель поднят, но VPN-узел не ответил на рукопожатие. " +
        "Проверьте доступность сервера и актуальность профиля подключения.");
}
/**
 * FIX-DATACHECK: дождаться настоящих ДАННЫХ из туннеля, а не только
 * рукопожатия.
 *
 * Зачем отдельная проверка. Рукопожатие доказывает ровно одно: узел жив и
 * ключи сошлись. Оно живёт в шифровальной части и НЕ зависит ни от
 * маршрутов, ни от разрешённых адресов, ни от того, умеет ли узел
 * выпускать наш трафик в интернет. Именно поэтому возможен был самый
 * болезненный исход: «подключено» — и при этом интернета нет нигде: ни в
 * браузере, ни в играх, ни в самом приложении, потому что весь трафик уже
 * завернут в туннель, а туннель никуда не ведёт.
 *
 * Признак работы — рост счётчика ПРИНЯТЫХ байт. Отправленные не годятся:
 * отправлять в пустоту можно бесконечно — именно так и выглядела поломка
 * со стороны сервера: 15 МБ принято, 4 КБ отправлено.
 *
 * За отправку первого пакета отвечает keepalive из настроек: ответные
 * keepalive узла уже дают принятые байты, так что ждать действий
 * пользователя не нужно.
 *
 * Возвращает флаг, а не падает сама: решение об откате принимает вызывающая
 * сторона — ей есть что убирать.
 */
async function readRx(path) {
    try {
        return (0, vpnEmbedded_1.parseUapiTransfer)(await uapiRequest(path, "get=1\n\n")).rx;
    }
    catch {
        return -1;
    }
}
/**
 * FIX-PROBE: собственный пробный запрос внутрь туннеля.
 *
 * Пассивное ожидание чужого трафика оказалось негодным способом: пока человек
 * не откроет сайт, из туннеля может не прийти ни байта, и рабочее подключение
 * выглядело бы сломанным. Поэтому спрашиваем сами — короткий запрос к серверу
 * имён из профиля. Он доступен только внутри туннеля, поэтому ответ на него и
 * есть то самое доказательство: данные ходят в обе стороны.
 *
 * Ошибки намеренно проглатываются: это проба, а не работа.
 */
function probeThroughTunnel(server) {
    try {
        const socket = (0, node_dgram_1.createSocket)(server.includes(":") ? "udp6" : "udp4");
        /* Минимальный запрос DNS: заголовок, имя `ya.ru`, тип A. */
        const query = Buffer.from([
            0x7a, 0x69, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x02, 0x79, 0x61, 0x02, 0x72, 0x75, 0x00, 0x00, 0x01, 0x00, 0x01,
        ]);
        const close = () => {
            try {
                socket.close();
            }
            catch {
                /* уже закрыт */
            }
        };
        socket.on("error", close);
        socket.on("message", close);
        socket.send(query, 53, server, () => setTimeout(close, 2_000));
    }
    catch {
        /* проба не обязана удаться */
    }
}
/**
 * FIX-PROBEGW: проба до второго конца туннеля — единственный адрес, который
 * гарантированно идёт в туннель при ЛЮБОМ режиме маршрутизации.
 *
 * Ответ на эхо-запрос — самодостаточное доказательство: пакет ушёл внутрь
 * туннеля, узел его расшифровал и ответил, ответ вернулся и был расшифрован.
 *
 * Код возврата `ping` в Windows ненадёжен: при полной потере пакетов он
 * бывает нулёвым, поэтому смотрим на признак настоящего ответа — `TTL`.
 */
function pingProbe(target) {
    const command = process.platform === "win32"
        ? ["ping", "-n", "1", "-w", "1500", target]
        : ["ping", "-c", "1", "-W", "2", target];
    const [file, ...args] = command;
    if (!file)
        return false;
    try {
        const result = (0, node_child_process_1.spawnSync)(file, args, { timeout: 5_000 });
        const text = `${decodeConsole(result.stdout)} ${decodeConsole(result.stderr)}`
            .replace(/\s+/g, " ")
            .trim();
        const answered = /ttl[=\s]*\d+/i.test(text);
        logSetup(`проба ${file} ${args.join(" ")} -> код ${result.status ?? "?"} | ответ: ${answered ? "есть" : "нет"}`);
        return answered;
    }
    catch {
        return false;
    }
}
async function waitForTraffic(path, timeoutMs, baseline, probeServers, gateway) {
    const start = baseline >= 0 ? baseline : await readRx(path);
    const deadline = Date.now() + timeoutMs;
    let tick = 0;
    while (Date.now() < deadline) {
        const rx = await readRx(path);
        if (rx > start)
            return true;
        /* Раз в полторы секунды подталкиваем туннель своим запросом. */
        if (tick % 3 === 0) {
            for (const server of probeServers.slice(0, 2))
                probeThroughTunnel(server);
            /* FIX-PROBEGW: главная проба — сам узел туннеля. Он внутри туннеля в обоих
               режимах, в отличие от сервера имён. */
            if (gateway && pingProbe(gateway))
                return true;
        }
        tick += 1;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    logSetup(`проверка трафика не прошла: принято байт как было (${start})`);
    return false;
}
/**
 * FIX-WINTUN: журнал встроенного клиента.
 *
 * Раньше вывод клиента уходил в `stdio: "ignore"`, и любая его беда выглядела
 * одинаково: «клиент не успел поднять сетевое устройство». Причина же почти
 * всегда конкретна и написана самим клиентом в первой строке: не загрузилась
 * `wintun.dll`, нет прав администратора, адаптер занят прежним процессом.
 * Теперь вывод пишется рядом с профилем и попадает в текст ошибки.
 */
exports.CLIENT_LOG = `${vpnPlan_1.TUNNEL_NAME}-client.log`;
/**
 * FIX-SETUPLOG: журнал шагов настройки сети — рядом с журналом клиента.
 *
 * Журнал клиента рассказывает про шифрование и рукопожатие, но ничего не знает
 * про адрес, маршруты и серверы имён — а ломается чаще всего именно это.
 */
exports.SETUP_LOG = `${vpnPlan_1.TUNNEL_NAME}-setup.log`;
let setupLogPath = "";
function logSetup(line) {
    if (!setupLogPath)
        return;
    try {
        (0, node_fs_1.appendFileSync)(setupLogPath, `${new Date().toISOString()} ${line}\n`);
    }
    catch {
        /* журнал не имеет права ломать подключение */
    }
}
/** Последние строки журнала клиента — для внятного сообщения об ошибке. */
function clientLogTail(logPath, lines = 6) {
    try {
        return (0, node_fs_1.readFileSync)(logPath, "utf8")
            .split(/\r?\n/)
            .filter((line) => line.trim().length > 0)
            .slice(-lines)
            .join("; ");
    }
    catch {
        return "";
    }
}
/**
 * FIX-WINTUN: подложить клиенту библиотеку сетевого устройства.
 *
 * Возвращает каталог, который нужно добавить в PATH дочернего процесса, или
 * пустую строку, если ничего добавлять не нужно (библиотека уже рядом с
 * клиентом). Копировать пытае��ся в папку клиента — так надёжнее всего, ведь
 * именно её Windows просматривает первой; если копирование не удалось (папка
 * установки только для чтения), обходимся PATH.
 */
function ensureWintun(clientDir) {
    if ((0, node_fs_1.existsSync)((0, node_path_1.join)(clientDir, vpnEmbedded_1.WINTUN_DLL)))
        return "";
    for (const dir of (0, vpnEmbedded_1.wintunSearchDirs)(process.env)) {
        const candidate = (0, node_path_1.join)(dir, vpnEmbedded_1.WINTUN_DLL);
        if (!(0, node_fs_1.existsSync)(candidate))
            continue;
        try {
            (0, node_fs_1.copyFileSync)(candidate, (0, node_path_1.join)(clientDir, vpnEmbedded_1.WINTUN_DLL));
            return "";
        }
        catch {
            return dir;
        }
    }
    fail("Сетевой драйвер Wintun не найден: ни в ресурсах приложения, ни в системе. " +
        "Переустановите приложение или укажите путь к wintun.dll в переменной TRIOZ_WINTUN_DIR.");
}
function psString(value) {
    return `'${value.replace(/'/g, "''")}'`;
}
/**
 * FIX-FULLTUN-WIN: найти именно тот Wintun-адаптер, который только что создал
 * wireguard-go, и вернуть его актуальный ifIndex.
 *
 * Имя интерфейса и индекс в Windows — не одно и то же. После пересоздания
 * Wintun индекс меняется (например, стал 45), а старые маршруты/команды могли
 * попадать в другой интерфейс или в запись по имени. Для full-tunnel это
 * критично: маршруты 0.0.0.0/1 и 128.0.0.0/1 должны указывать на реальный
 * WireGuard-адаптер, иначе handshake есть, а интернет не идёт.
 */
function waitForAdapter(iface, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    const wanted = psString(iface);
    const script = `$a = Get-NetAdapter -Name ${wanted} -ErrorAction SilentlyContinue | ` +
        "Sort-Object ifIndex -Descending | Select-Object -First 1; " +
        "if (-not $a) { $a = Get-NetAdapter -ErrorAction SilentlyContinue | " +
        `Where-Object { $_.InterfaceDescription -match 'Wintun|WireGuard' -and $_.Name -eq ${wanted} } | ` +
        "Sort-Object ifIndex -Descending | Select-Object -First 1 }; " +
        'if ($a) { "$($a.Name)|$($a.ifIndex)|$($a.InterfaceAlias)" }';
    while (Date.now() < deadline) {
        const result = (0, node_child_process_1.spawnSync)("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
            encoding: "utf8",
            timeout: 20_000,
            windowsHide: true,
        });
        const line = (result.stdout || "").trim().split(/\r?\n/).find(Boolean);
        if (line) {
            const [name, indexText, alias] = line.split("|");
            const interfaceIndex = Number(indexText);
            if (name && Number.isFinite(interfaceIndex) && interfaceIndex > 0) {
                const adapter = { name, interfaceIndex, interfaceAlias: alias || name };
                logSetup(`Wintun адаптер найден: name=${adapter.name}, ifIndex=${adapter.interfaceIndex}, alias=${adapter.interfaceAlias}`);
                return adapter;
            }
        }
        const wait = Date.now() + 400;
        while (Date.now() < wait) {
            /* короткая пауза без таймеров: работник живёт ровно один сценарий */
        }
    }
    return null;
}
/** Файл с параметрами маршрута-исключения — чтобы снять его при выключении. */
exports.EXCLUDE_FILE = `${vpnPlan_1.TUNNEL_NAME}.exclude`;
exports.IFACE_FILE = `${vpnPlan_1.TUNNEL_NAME}.ifindex`;
/** Адрес узла: маршрут в Windows задаётся только IP, имя не подходит. */
async function resolveEndpointIp(endpoint) {
    const host = (0, vpnEmbedded_1.endpointHost)(endpoint);
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host))
        return host;
    const { address } = await (0, promises_1.lookup)(host, { family: 4 });
    return address;
}
/** Текущий шлюз и интерфейс выхода в сеть до подъёма туннеля. */
function findDefaultRoute() {
    const script = "$r = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | " +
        "Where-Object { $_.NextHop -ne '0.0.0.0' } | Sort-Object RouteMetric | Select-Object -First 1; " +
        'if ($r) { "$($r.NextHop) $($r.InterfaceIndex)" }';
    const result = (0, node_child_process_1.spawnSync)("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
        encoding: "utf8",
        timeout: 20_000,
        windowsHide: true,
    });
    if (result.error || result.status !== 0)
        return null;
    return (0, vpnEmbedded_1.parseDefaultRoute)(result.stdout || "");
}
/** Снять прежний клиент, если он ещё жив (после аварийного выхода). */
function killPrevious(pidPath) {
    if (!(0, node_fs_1.existsSync)(pidPath))
        return;
    const pid = Number((0, node_fs_1.readFileSync)(pidPath, "utf8").trim());
    if (Number.isFinite(pid) && pid > 1) {
        try {
            process.kill(pid, "SIGTERM");
        }
        catch {
            /* процесса уже нет — цель достигнута */
        }
    }
    try {
        (0, node_fs_1.rmSync)(pidPath, { force: true });
    }
    catch {
        /* не мешает дальнейшему поднятию */
    }
}
/**
 * Поднять туннель: запустить встроенный клиент, настроить его по UAPI и
 * привести интерфейс в рабочее состояние штатными утилитами ОС.
 */
async function up(confPath, clientPath) {
    if (!(0, node_fs_1.existsSync)(confPath))
        fail("Профиль подключения не найден");
    if (!(0, node_fs_1.existsSync)(clientPath))
        fail("Встроенный клиент не найден в ресурсах приложения");
    const parsed = (0, vpnEmbedded_1.parseWgConfig)((0, node_fs_1.readFileSync)(confPath, "utf8"));
    if (!(0, vpnEmbedded_1.isUsableConfig)(parsed))
        fail("Профиль подключения неполон: нет ключа, адреса или сервера");
    const routeAll = (0, vpnEmbedded_1.routesEverything)(parsed);
    /* FIX-FULLTUN-ENDPOINT: физический маршрут до VPN endpoint надо запоминать ДО
       запуска Wintun и до любых адресов/маршрутов туннеля. После создания
       адаптера Windows уже может видеть on-link/default-кандидаты через Wintun,
       и выбор «лучшего default route» начнёт указывать на сам туннель. Тогда
       добавленный endpoint-exclude формально есть, но ведёт через WireGuard —
       после первого handshake клиент перестаёт слышать сервер и уходит в retry. */
    const preTunnelDefaultRoute = process.platform === "win32" && routeAll ? findDefaultRoute() : null;
    if (process.platform === "win32" && routeAll && !preTunnelDefaultRoute) {
        fail("Не удалось определить основной шлюз системы до запуска туннеля");
    }
    /**
     * FIX-BACKEND: протокол клиента обязан совпадать с протоколом профиля.
     *
     * В профиле с параметрами маскировки (Jc/S1/H1 и прочие) служебные пакеты
     * выглядят иначе, чем в обычном WireGuard. Обычный клиент отправляет
     * рукопожатие старого вида, узел с маскировкой его молча отбрасывает — и со стороны
     * это выглядит ровно как «туннель поднят, а узел не ответил на рукопожатие»:
     * проверять тут нечего, сервер жив и профиль верен, несовпадают только версии
     * протокола. Говорим об этом сразу и прямо, а не ждём 20 секунд впустую.
     */
    const profileNeedsAwg = Object.keys(parsed.extra).length > 0;
    const clientIsAwg = /amnezia/i.test(clientPath);
    if (profileNeedsAwg && !clientIsAwg) {
        fail("Профиль выдан для устойчивого к блокировкам режима (AmneziaWG), а в сборке есть только " +
            "клиент обычного WireGuard. Соберите приложение с amneziawg-go либо переведите узел в обычный режим.");
    }
    if (!profileNeedsAwg && clientIsAwg) {
        /* Обратный случай безопасен: без параметров amneziawg-go ведёт себя как обычный
           WireGuard, но в журнале это должно быть видно. */
        process.stderr.write("[trioz] профиль без маскировки поднимается клиентом AmneziaWG\n");
    }
    const pidPath = (0, node_path_1.join)((0, node_path_1.dirname)(confPath), exports.PID_FILE);
    killPrevious(pidPath);
    /* С этой строки любой выход с ошибкой обязан вернуть сеть как было. */
    rollbackDir = (0, node_path_1.dirname)(confPath);
    /* FIX-SETUPLOG: с этого места каждый шаг настройки сети пишется в журнал. */
    setupLogPath = (0, node_path_1.join)((0, node_path_1.dirname)(confPath), exports.SETUP_LOG);
    try {
        (0, node_fs_1.writeFileSync)(setupLogPath, "", { mode: 0o600 });
    }
    catch {
        /* журнал не имеет права ломать подключение */
    }
    const socketPath = (0, vpnEmbedded_1.uapiSocketPath)(process.platform);
    const clientDir = (0, node_path_1.dirname)(clientPath);
    let extraPathDir = "";
    if (process.platform === "win32") {
        /* Сетевое устройство в Windows создаёт wintun.dll, которую загружает сам
           клиент. Если её нет рядом с клиентом — ищем установленную в с��стеме и
           подкладываем: иначе клиент падает на загрузке библиотеки, а человек
           видит лишь «адаптер не создан». */
        extraPathDir = ensureWintun(clientDir);
    }
    else {
        /* Каталог сокетов обычно создаёт сам клиент, но на чистой системе его
           может не быть, а без каталога клиент молча не поднимает UAPI. */
        try {
            (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(socketPath), { recursive: true, mode: 0o700 });
        }
        catch {
            /* уже есть — хорошо */
        }
        try {
            (0, node_fs_1.rmSync)(socketPath, { force: true });
        }
        catch {
            /* старый сокет от аварийно умершего клиента мешать не должен */
        }
    }
    /* Клиент отвязывается от нашего процесса: он обязан пережить и этого
       работника, и перезапуск окна приложения. */
    const logPath = (0, node_path_1.join)((0, node_path_1.dirname)(confPath), exports.CLIENT_LOG);
    const logFd = (0, node_fs_1.openSync)(logPath, "w");
    const child = (0, node_child_process_1.spawn)(clientPath, [vpnPlan_1.TUNNEL_NAME], {
        detached: true,
        /* FIX-WINTUN: вывод клиента — в журнал, а не в пустоту: это единственный
           источник причины, когда адаптер не создаётся. */
        stdio: ["ignore", logFd, logFd],
        /* Рабочая папка — рядом с клиентом. */
        cwd: clientDir,
        env: {
            ...process.env,
            /* Клиент не должен уходить в фон сам: тогда наш PID указывал бы на уже
               завершившийся процесс-родитель, и выключение туннеля никого не снимало. */
            WG_PROCESS_FOREGROUND: "1",
            /* Подробный журнал — о�� и объясняет отказы создания адаптера. */
            LOG_LEVEL: process.env.LOG_LEVEL || "verbose",
            ...(extraPathDir
                ? { PATH: `${extraPathDir};${process.env.PATH ?? ""}` }
                : {}),
        },
    });
    /* Ранняя смерть клиента — самый частый случай: нет прав, нет библиотеки,
       адаптер занят. Запоминаем код выхода, чтобы не ждать зря 20 секунд. */
    let exitCode = null;
    child.on("exit", (code) => {
        exitCode = code ?? 0;
    });
    child.on("error", () => {
        exitCode = -1;
    });
    child.unref();
    if (typeof child.pid === "number") {
        (0, node_fs_1.writeFileSync)(pidPath, `${child.pid}\n`, { mode: 0o600 });
    }
    await waitForUapi(socketPath, 20_000, logPath, () => exitCode);
    /* Адаптер должен быть виден системе под своим именем — только тогда с ним
       заработает `netsh`, то есть только тогда туннель получит адрес. */
    const winAdapter = process.platform === "win32" ? waitForAdapter(vpnPlan_1.TUNNEL_NAME, 15_000) : null;
    if (process.platform === "win32" && !winAdapter) {
        const tail = clientLogTail(logPath);
        fail(`Сетевой адаптер «${vpnPlan_1.TUNNEL_NAME}» не появился в системе.` +
            (tail ? ` Клиент сообщает: ${tail}` : "") +
            ` Полный журнал: ${logPath}`);
    }
    let response;
    try {
        response = await uapiRequest(socketPath, (0, vpnEmbedded_1.uapiSetRequest)(parsed, routeAll, process.platform));
    }
    catch (err) {
        fail(err instanceof Error ? err.message : "Не удалось настроить встроенный клиент");
    }
    assertUapiOk(response);
    /* Адрес и маршруты — обязательные шаги: без них туннель поднят, но трафик
       в него не пойдёт — самый неприятный вид поломки: «включено» и не работает. */
    /* Windows, режим «весь трафик»: СНАЧАЛА узкий маршрут до самого VPN-узла
       через прежний шлюз, и только потом — две половины в туннель. В обратном
       порядке клиент начинает отправлять рукопожатие в самого себя. */
    if (process.platform === "win32" && routeAll) {
        const endpoint = parsed.peers.find((peer) => peer.endpoint)?.endpoint;
        if (!endpoint)
            fail("В профиле подключения нет адреса сервера");
        let endpointIp = "";
        try {
            endpointIp = await resolveEndpointIp(endpoint);
        }
        catch {
            fail("Не удалось определить адрес VPN-узла по его имени");
        }
        const gate = preTunnelDefaultRoute;
        if (!gate) {
            fail("Не удалось определить основной шлюз системы: без него туннель замкнётся сам на себя");
        }
        logSetup(`endpoint-exclude: ${endpointIp}/32 через шлюз ${gate.gateway}, физический ifIndex=${gate.interfaceIndex}`);
        runTool((0, vpnEmbedded_1.excludeRouteCommand)(endpointIp, gate.gateway, gate.interfaceIndex), true);
        if (winAdapter)
            (0, node_fs_1.writeFileSync)((0, node_path_1.join)((0, node_path_1.dirname)(confPath), exports.IFACE_FILE), `${winAdapter.interfaceIndex}\n`, { mode: 0o600 });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)((0, node_path_1.dirname)(confPath), exports.EXCLUDE_FILE), `${endpointIp} ${gate.interfaceIndex}\n`, {
            mode: 0o600,
        });
    }
    /* Адрес и MTU — сразу: без адреса интерфейс не работает вовсе. Маршруты и
       DNS здесь сознательно НЕ ставятся — см. ниже. */
    const winIface = winAdapter ? String(winAdapter.interfaceIndex) : vpnPlan_1.TUNNEL_NAME;
    for (const command of (0, vpnEmbedded_1.ifaceUpCommands)(process.platform, parsed, winIface)) {
        /* Адрес IPv4 — единственный шаг, без которого туннель бессмыслен: тихо
           провалившийся `netsh set address` давал «включено, а трафик напрямую».
           Шаги IPv6 такого веса не имеют — см. isCriticalStep (FIX-NETSH6). */
        runTool(command, isCriticalStep(command));
    }
    /* FIX-NOROUTE: сначала реальное рукопожатие с узлом — и только потом перевод
       трафика в туннель. Раньше порядок был обратный, и молчание узла
       оборачивалось полным отсутствием интернета на всём компьютере: маршруты
       уже вели в туннель, а туннель никуда не вёл. Инициатива здесь наша:
       keepalive в настройках заставляет клиента послать первый пакет сам, н��
       дожидаясь пользовательского трафика. */
    await waitForHandshake(socketPath, 20_000);
    /* FIX-TRAFFIC2: отсчёт принятых байт снимается ДО переключения маршрутов.
       Раньше он снимался после — и настоящий ответ, пришедший в первые
       миллисекунды после рукопожатия, попадал в исходное значение и не
       засчитывался как трафик. Рабочий туннель мог быть объявлен сломанным. */
    const trafficBaseline = await readRx(socketPath);
    /* FIX-DAD: адресу нужно мгновение, чтобы стать рабочим. С отключённой
       проверкой занятости ожидание короткое, но пропускать его нельзя:
       маршруты, поставленные на ещё проверяемый (Tentative) адрес, Windows для
       отправки не использует. */
    if (process.platform === "win32") {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    for (const command of (0, vpnEmbedded_1.ifaceRouteCommands)(process.platform, parsed, winIface)) {
        /* FIX-NETSH6: рукопожатие уже состоялось — туннель живой. Ронять его из-за
           отказа на второстепенном шаге (IPv6, сервер имён) — значит отобрать у
           человека работающее подключение ради чистоты журнала. */
        runTool(command, isCriticalStep(command));
    }
    /* FIX-DATACHECK: маршруты уже ведут в туннель — теперь убеждаемся, что он
       действительно несёт данные, и если нет — возвращаем всё как было.
  
       Это главная защита пользователя. Лучше сказать «подключиться не
       удалось» при живом интернете, чем оставить человека без сети вообще и
       без возможности даже открыть приложение, чтобы выключить VPN. Откат
       полный — `down` снимает маршруты, DNS, маршрут-исключение и самого
       клиента, то есть состояние сети возвращается к допусковому. */
    /* FIX-PROBEGW: в режиме «только приложение» сервер имён из профиля в туннель НЕ
       идёт, поэтому спрашивать его бессмысленно — проба уйдёт мимо и проверка
       гарантированно соврёт. Спрашиваем узел туннеля. */
    const gateway = (0, vpnEmbedded_1.tunnelGatewayIp)(parsed);
    if (!(await waitForTraffic(socketPath, 25_000, trafficBaseline, routeAll ? parsed.dns : [], gateway))) {
        down((0, node_path_1.dirname)(confPath), true);
        fail("Узел ответил на рукопожатие, но обратный трафик через туннель не пошёл. " +
            "Маршруты и серверы имён возвращены на место — обычный интернет работает. " +
            `Что именно применялось: ${(0, node_path_1.join)((0, node_path_1.dirname)(confPath), exports.SETUP_LOG)}. ` +
            `Журнал клиента: ${logPath}`);
    }
    /* Туннель работает: аварийная уборка больше не нужна — дальше маршруты
       снимает обычное выключение. */
    tunnelReady = true;
    process.stdout.write("ok\n");
}
/** Снять туннель: убить клиента и убрать за ним правила маршрутизации. */
function down(confDir, quiet = false) {
    const savedIndexPath = (0, node_path_1.join)(confDir, exports.IFACE_FILE);
    let downIface = vpnPlan_1.TUNNEL_NAME;
    if (process.platform === "win32" && (0, node_fs_1.existsSync)(savedIndexPath)) {
        const saved = (0, node_fs_1.readFileSync)(savedIndexPath, "utf8").trim();
        if (/^\d+$/.test(saved))
            downIface = saved;
    }
    for (const command of (0, vpnEmbedded_1.ifaceDownCommands)(process.platform, downIface))
        runTool(command, false);
    /* Маршрут-исключение указывает на ФИЗИЧЕСКИЙ интерфейс и потому не исчезает
       вместе с туннелем — снимаем его по записанным при подъёме данным. */
    const excludePath = (0, node_path_1.join)(confDir, exports.EXCLUDE_FILE);
    if ((0, node_fs_1.existsSync)(excludePath)) {
        const [ip, index] = (0, node_fs_1.readFileSync)(excludePath, "utf8").trim().split(/\s+/);
        if (ip && index)
            runTool((0, vpnEmbedded_1.excludeRouteDeleteCommand)(ip, Number(index)), false);
        try {
            (0, node_fs_1.rmSync)(excludePath, { force: true });
        }
        catch {
            /* файл мог исчезнуть раньше — цель достигнута */
        }
    }
    try {
        (0, node_fs_1.rmSync)(savedIndexPath, { force: true });
    }
    catch {
        /* файл мог исчезнуть раньше */
    }
    killPrevious((0, node_path_1.join)(confDir, exports.PID_FILE));
    try {
        (0, node_fs_1.rmSync)((0, vpnEmbedded_1.uapiSocketPath)(process.platform), { force: true });
    }
    catch {
        /* сокет исчезает вместе с клиентом */
    }
    if (!quiet)
        process.stdout.write("ok\n");
}
async function main() {
    const [action, first, second] = process.argv.slice(2);
    if (action === "up") {
        if (!first || !second)
            fail("Неверные аргументы запуска туннеля");
        await up(first, second);
        return;
    }
    if (action === "down") {
        down(first || ".");
        return;
    }
    fail("Неизвестное действие");
}
void main().catch((err) => {
    fail(err instanceof Error ? err.message : "Неожиданная ошибка встроенного клиента");
});
//# sourceMappingURL=vpnHelper.js.map