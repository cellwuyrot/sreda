"use strict";
/**
 * VPN-EMBEDDED: чистая логика ВСТРОЕННОГО клиента туннеля.
 *
 * Зачем этот модуль появился. С `VPN-ONECLICK` оболочка перестала отдавать
 * файл-профиль и стала поднимать туннель сама — но поднимала она его ЧУЖИМ
 * клиентом: искала в системе `wireguard.exe` или `wg-quick` и, не найдя,
 * честно писала «установите WireGuard». То есть кнопка включения работала
 * только у того, кто до неё уже скачал сторонний клиент. Для человека это
 * выглядит так, будто своего VPN в приложении нет.
 *
 * Теперь клиент — часть сборки. Приложение носит с собой бинарник
 * пользовательской реализации WireGuard (`wireguard-go` / `amneziawg-go`) на
 * ВСЕХ трёх системах и настраивает туннель САМО, по протоколу UAPI, не вызывая
 * ни `wg`/`wg-quick`, ни `wireguard.exe`. Скачивать пользователю нечего.
 *
 * Почему на Windows тоже своя реализация, а не официальный `wireguard.exe`.
 * Первая версия носила в ресурсах именно его и ставила туннель командой
 * `/installtunnelservice`. Это оказалось привязкой к чужому продукту: команда
 * создаёт в системе службу `WireGuardTunnel$trioz` (видимую в списке служб),
 * работает только вместе со службой-менеджером WireGuard — без неё отвечает
 * «The specified service does not exist as an installed service», — а при любом
 * непонятном ей аргументе этот файл просто ОТКРЫВАЕТ ОКНО WireGuard. Своё
 * приложение не должно ни ставить чужих служб, ни открывать чужих окон:
 * `wireguard-go.exe` — обычный процесс без служб, сетевое устройство он создаёт
 * через `wintun.dll` из тех же ресурсов.
 *
 * Здесь — только чистые функции: разбор профиля, сборка UAPI-запроса, список
 * команд настройки интерфейса. Ни одного побочного эффекта: всё, что ломается
 * тихо (перевод ключей base64 → hex, порядок строк UAPI, маршрут по умолчанию
 * через fwmark), закрыто тестами. Запуск процессов — в `main/vpnHelper.ts`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_TUNNEL_MTU = exports.MAX_TUNNEL_MTU = exports.SAFE_TUNNEL_MTU = exports.DEFAULT_KEEPALIVE_SECONDS = exports.WINTUN_DLL = exports.EMBEDDED_DIR = exports.WIN_LOOPBACK_INDEX = exports.ROUTE_MARK = void 0;
exports.safeMtu = safeMtu;
exports.hasV6Tunnel = hasV6Tunnel;
exports.wintunSearchDirs = wintunSearchDirs;
exports.embeddedClientName = embeddedClientName;
exports.parseWgConfig = parseWgConfig;
exports.isUsableConfig = isUsableConfig;
exports.base64KeyToHex = base64KeyToHex;
exports.uapiSetRequest = uapiSetRequest;
exports.parseUapiHandshake = parseUapiHandshake;
exports.parseUapiTransfer = parseUapiTransfer;
exports.routesEverything = routesEverything;
exports.ipv4Mask = ipv4Mask;
exports.endpointHost = endpointHost;
exports.tunnelSubnetCidr = tunnelSubnetCidr;
exports.tunnelGatewayIp = tunnelGatewayIp;
exports.ifaceUpCommands = ifaceUpCommands;
exports.ifaceRouteCommands = ifaceRouteCommands;
exports.ifaceDownCommands = ifaceDownCommands;
exports.excludeRouteCommand = excludeRouteCommand;
exports.excludeRouteDeleteCommand = excludeRouteDeleteCommand;
exports.parseDefaultRoute = parseDefaultRoute;
exports.uapiSocketPath = uapiSocketPath;
const vpnPlan_1 = require("./vpnPlan");
/**
 * Метка маршрутизации для режима «весь трафик». Тем же числом помечаются пакеты
 * самого туннеля (`fwmark` в UAPI) и таблица маршрутов, чтобы исходящие пакеты
 * WireGuard не заворачивались в сам туннель — классическая петля, из-за которой
 * соединение поднимается и сразу умирает. Значение совпадает с тем, что
 * использует `wg-quick` (51820), — так две реализации не спорят друг с другом.
 */
exports.ROUTE_MARK = 51820;
/**
 * Индекс петлевого интерфейса Windows («Loopback Pseudo-Interface 1»). Он
 * одинаков во всех версиях системы и потому задан числом: маршрут, ведущий
 * сюда, гарантированно никуда не уходит. Используется как отсутствующий в
 * `netsh` blackhole — см. FIX-V6WIN.
 */
exports.WIN_LOOPBACK_INDEX = 1;
/** Имя каталога с встроенными бинарниками внутри ресурсов приложения. */
exports.EMBEDDED_DIR = "wireguard";
/**
 * Драйвер сетевого устройства для Windows. Лежит рядом с клиентом в ресурсах:
 * `wireguard-go.exe` подгружает его сам и без него не создаст интерфейс.
 * Библиотека распространяемая и подписана WireGuard LLC — своей сборки не
 * требует, но и в git её держать незачем (см. scripts/vendor-wireguard.mjs).
 */
exports.WINTUN_DLL = "wintun.dll";
/**
 * FIX-WGHANDSHAKE: интервал keepalive по умолчанию.
 *
 * 25 секунд — общепринятое значение для WireGuard: меньше типового времени
 * жизни записи в NAT (30 с), поэтому обратный путь до нас не закрывается.
 */
exports.DEFAULT_KEEPALIVE_SECONDS = 25;
/**
 * FIX-MTU: безопасный MTU туннеля.
 *
 * Почему это вообще важно. WireGuard добавляет к каждому пакету свои 60 байт
 * (20 IPv4 + 8 UDP + 32 служебных), и если внутренний пакет вышел больше
 * путевого MTU, его придётся фрагментировать или отбросить. Со стороны это
 * самый неприятный из возможных отказов: рукопожатие есть, пинг идёт, мелкие
 * запросы работают, а страницы и видео виснут навсегда — и выглядит это как
 * «интернет тормозит», а не как ошибка VPN.
 *
 * 1280 — нижняя граница IPv6 и одновременно значение, которое проходит везде:
 * через мобильные сети, PPPoE, двойной NAT и туннели провайдера. Ставить
 * больше ради процента пропускной способности не стоит: цена ошибки —
 * молчащие соединения, которые потом невозможно найти.
 */
exports.SAFE_TUNNEL_MTU = 1280;
/** Выше этого значения туннель не поднимаем никогда: 1500 − 60 служебных. */
exports.MAX_TUNNEL_MTU = 1420;
/** Ниже этого IPv6 вообще не работает, а IPv4 начинает рвать TLS-рукопожатия. */
exports.MIN_TUNNEL_MTU = 1280;
/**
 * MTU, с которым поднимаем интерфейс.
 *
 * Значение из профиля уважаем, но зажимаем в разумные границы, а при его
 * отсутствии берём безопасное. До этого MTU вообще не выставлялся, если его не
 * было в профиле, и туннель получал системные 1500 — то есть гарантированную
 * фрагментацию на любом реальном канале.
 */
function safeMtu(parsed) {
    const wanted = parsed.mtu && parsed.mtu > 0 ? parsed.mtu : exports.SAFE_TUNNEL_MTU;
    return Math.max(exports.MIN_TUNNEL_MTU, Math.min(exports.MAX_TUNNEL_MTU, Math.trunc(wanted)));
}
/** Есть ли у туннеля свой IPv6: от этого зависит, маршрутизуем мы v6 или глушим. */
function hasV6Tunnel(parsed) {
    return parsed.addresses.some((address) => address.includes(":"));
}
/**
 * FIX-WINTUN: где ещё в Windows может лежать `wintun.dll`, кроме ресурсов
 * приложения.
 *
 * Библиотеку ищет сам Windows при загрузке клиента, и ищет он её ТОЛЬКО в папке
 * исполняемого файла, System32 и каталогах PATH — рабочая папка процесса в этот
 * список не входит. Поэтому «Wintun установлен» само по себе ничего не давало:
 * распакованная пользователем библиотека лежала там, куда клиент не смотрит.
 * Список проверяем сами и подкладываем найденное клиенту.
 */
function wintunSearchDirs(env) {
    const dirs = [];
    const push = (dir) => {
        if (dir && !dirs.includes(dir))
            dirs.push(dir);
    };
    /* Явное указание пути перекрывает всё: это путь для нестандартных сборок. */
    push(env.TRIOZ_WINTUN_DIR);
    const programFiles = env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = env["ProgramFiles(x86)"];
    const systemRoot = env.SystemRoot || "C:\\Windows";
    /* Официальный арх��в wintun распаковывается как `wintun/bin/<арх>/wintun.dll`. */
    push(`${programFiles}\\Wintun\\bin\\amd64`);
    push(`${programFiles}\\Wintun\\bin\\arm64`);
    push(`${programFiles}\\Wintun`);
    push(`${programFiles}\\WireGuard`);
    if (programFilesX86)
        push(`${programFilesX86}\\Wintun`);
    push(`${systemRoot}\\System32`);
    return dirs;
}
/**
 * Имя встроенного бинарника клиента для платформы и стека.
 *
 * Везде одна и та же пользовательская реализация на Go, только с расширением
 * `.exe` на Windows. Она не требует ни модуля ядра, ни пакета
 * `wireguard-tools`, ни служб: туннель настраивается через UAPI — то есть без
 * `wg`, `wg-quick` и `wireguard.exe`.
 */
function embeddedClientName(platform, backend) {
    /* FIX-AWG-ONLY: имя одно на все случаи. Раньше здесь была развилка, и при
       backend === "wireguard" в ресурсах искался wireguard.exe, которого в сборке
       больше нет — приложение честно сообщало «клиент не найден» вместо работы. */
    void backend;
    if (platform === "win32")
        return "amneziawg.exe";
    return "amneziawg-go";
}
/** Значения `AllowedIPs`/`DNS` перечисляются через запятую. */
function splitList(value) {
    return value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
}
/**
 * Разбор профиля WireGuard в структуру.
 *
 * Разбираем сами, а не отдаём файл сторонней утилите, потому что настраивать
 * туннель мы будем через UAPI, где нужны отдельные поля, а не текст профиля.
 * Регистр ключей в профиле произвольный (`PrivateKey`, `privatekey`), поэтому
 * сравнение — по нижнему регистру.
 */
function parseWgConfig(config) {
    const result = {
        privateKey: "",
        addresses: [],
        dns: [],
        mtu: null,
        extra: {},
        peers: [],
    };
    /** Ключи маскировки: в UAPI уходят в нижнем регистре, поэтому храним имя как есть. */
    const obfuscationKeys = new Set([
        "jc", "jmin", "jmax",
        "s1", "s2", "s3", "s4",
        "h1", "h2", "h3", "h4",
        "i1", "i2", "i3", "i4", "i5",
    ]);
    let section = "none";
    let peer = null;
    const closePeer = () => {
        if (peer && peer.publicKey)
            result.peers.push(peer);
        peer = null;
    };
    for (const rawLine of config.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#") || line.startsWith(";"))
            continue;
        if (line.startsWith("[")) {
            const name = line.slice(1, line.indexOf("]") === -1 ? undefined : line.indexOf("]")).toLowerCase();
            if (name === "interface") {
                closePeer();
                section = "interface";
            }
            else if (name === "peer") {
                closePeer();
                section = "peer";
                peer = { publicKey: "", presharedKey: null, endpoint: null, allowedIps: [], persistentKeepalive: null };
            }
            else {
                closePeer();
                section = "none";
            }
            continue;
        }
        const eq = line.indexOf("=");
        if (eq <= 0)
            continue;
        const key = line.slice(0, eq).trim().toLowerCase();
        /* Значение обрезаем только по краям: base64-ключ сам содержит `=`, поэтому
           делим строку по ПЕРВОМУ знаку равенства, а не по каждому. */
        const value = line.slice(eq + 1).trim();
        if (!value)
            continue;
        if (section === "interface") {
            if (key === "privatekey")
                result.privateKey = value;
            else if (key === "address")
                result.addresses.push(...splitList(value));
            else if (key === "dns")
                result.dns.push(...splitList(value));
            else if (key === "mtu") {
                const mtu = Number(value);
                if (Number.isFinite(mtu) && mtu > 0)
                    result.mtu = Math.trunc(mtu);
            }
            else if (obfuscationKeys.has(key))
                result.extra[key] = value;
            continue;
        }
        if (section === "peer" && peer) {
            if (key === "publickey")
                peer.publicKey = value;
            else if (key === "presharedkey")
                peer.presharedKey = value;
            else if (key === "endpoint")
                peer.endpoint = value;
            else if (key === "allowedips")
                peer.allowedIps.push(...splitList(value));
            else if (key === "persistentkeepalive") {
                const seconds = Number(value);
                if (Number.isFinite(seconds) && seconds >= 0)
                    peer.persistentKeepalive = Math.trunc(seconds);
            }
        }
    }
    closePeer();
    return result;
}
/** Профиль пригоден для поднятия, только если есть свой ключ и хотя бы один пир с адресом. */
function isUsableConfig(parsed) {
    return (parsed.privateKey.length > 0 &&
        parsed.addresses.length > 0 &&
        parsed.peers.some((p) => p.publicKey.length > 0 && !!p.endpoint));
}
/* ────────────────────────── UAPI ────────────────────────── */
/**
 * Ключ base64 (как в профиле) → hex (как требует UAPI).
 *
 * Это ровно то место, где встроенный клиент заменяет `wg`: утилита переводила
 * ключи сама, а теперь перевод наш. Ключ WireGuard — всегда 32 байта; всё
 * остальное означает битый профиль, и лучше упасть здесь, чем поднять туннель
 * с мусорным клю����ом и полчаса искать, почему нет рукопожатия.
 */
function base64KeyToHex(key) {
    const raw = Buffer.from(key, "base64");
    if (raw.length !== 32)
        throw new Error("Ключ подключения имеет неверную длину");
    return raw.toString("hex");
}
/**
 * UAPI-запрос `set=1` для ��строенного клиента.
 *
 * Порядок строк в UAPI зн��чим: параметры устройства идут до первого
 * `public_key=`, а всё после него относится к этому пиру. Поэтому маскировка и
 * `fwmark` пишутся первыми, а `replace_peers` — до пиров.
 *
 * @param routeAll — режим «весь трафик»: помечаем пакеты туннеля меткой, иначе
 *   маршрут по умолчанию завернёт трафик самого туннеля в туннель.
 */
function uapiSetRequest(parsed, routeAll, platform = process.platform) {
    const lines = ["set=1", `private_key=${base64KeyToHex(parsed.privateKey)}`];
    /* Метка маршрутизации есть только в Linux: в macOS её роль играет отдельный
       маршрут до точки подключения (см. ifaceUpCommands). */
    if (routeAll && platform === "linux")
        lines.push(`fwmark=${exports.ROUTE_MARK}`);
    for (const [key, value] of Object.entries(parsed.extra))
        lines.push(`${key}=${value}`);
    lines.push("replace_peers=true");
    for (const peer of parsed.peers) {
        if (!peer.publicKey)
            continue;
        lines.push(`public_key=${base64KeyToHex(peer.publicKey)}`);
        if (peer.presharedKey)
            lines.push(`preshared_key=${base64KeyToHex(peer.presharedKey)}`);
        if (peer.endpoint)
            lines.push(`endpoint=${peer.endpoint}`);
        /* FIX-WGHANDSHAKE: клиент WireGuard начинает рукопожатие не при подъёме
           интерфейса, а при ПЕРВОМ исходящем пакете в сторону узла — либо сразу,
           если задан keepalive. Профиль без `PersistentKeepalive` давал ровно то,
           что видно со стороны сервера: адаптер поднят, ключи заданы, а инициации
           нет, потому что трафика ещё не было (а он и не пойдёт, пока мы ждём
           рукопожатия — замкнутый круг). Поэтому keepalive задаём всегда, а
           значение из профиля уважаем, если оно там есть и не нулевое. */
        const keepalive = peer.persistentKeepalive !== null && peer.persistentKeepalive > 0
            ? peer.persistentKeepalive
            : exports.DEFAULT_KEEPALIVE_SECONDS;
        lines.push(`persistent_keepalive_interval=${keepalive}`);
        lines.push("replace_allowed_ips=true");
        /* FIX-V6ALLOWED: если у туннеля НЕТ своего адреса IPv6, семейство v6 из
           разрешённых адресов вырезается.
    
           Причина найдена по журналу ядра узла: `Packet has unallowed src IP
           (fe80::…)`. Windows отправляет служебные пакеты канального уровня в
           любой поднятый адаптер, и адрес источника у них — локальный `fe80::`,
           потому что глобального v6 у туннеля нет. Разрешение `::/0` заставляло
           клиента шифровать этот мусор и отправлять его узлу, а узел обязан такие
           пакеты отбрасывать: заявленный пир владеет только `10.8.0.2/32`. Со
           стороны человека это выглядело как «туннель поднят, трафика нет».
    
           Вырезать безопасно: без собственного адреса v6 туннель всё равно не
           может нести это семейство. */
        const v6Usable = hasV6Tunnel(parsed);
        for (const cidr of peer.allowedIps) {
            if (!v6Usable && isV6(cidr))
                continue;
            lines.push(`allowed_ip=${cidr}`);
        }
    }
    /* UAPI-запрос завершается ПУСТОЙ строкой — без неё клиент ждёт продолжения. */
    return `${lines.join("\n")}\n\n`;
}
/**
 * Разбор ответа UAPI `get=1` — время последнего рукопожатия (Unix-секунды).
 *
 * Так встроенный клиент отвечает на вопрос «связь есть?» без утилиты `wg`:
 * ответ приходит строками `ключ=значение`, нас интересует
 * `last_handshake_time_sec`.
 */
function parseUapiHandshake(response) {
    let max = 0;
    for (const line of response.split(/\r?\n/)) {
        const [key, value] = line.split("=");
        if (key?.trim() !== "last_handshake_time_sec")
            continue;
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds > max)
            max = seconds;
    }
    return max;
}
/**
 * Принято и отправлено байт по ответу UAPI `get=1` — суммарно по всем пирам.
 *
 * Нужно, чтобы отличить «туннель поднят» от «туннель работает». Рукопожатие
 * состоялось ещё не значит, что данные идут: оно живёт в шифровальной части и
 * не зависит ни от маршрутов, ни от разрешённых адресов. Признак настоящей
 * связи — растущий счётчик ПРИНЯТЫХ байт.
 */
function parseUapiTransfer(response) {
    let rx = 0;
    let tx = 0;
    for (const line of response.split(/\r?\n/)) {
        const eq = line.indexOf("=");
        if (eq <= 0)
            continue;
        const key = line.slice(0, eq).trim();
        const value = Number(line.slice(eq + 1).trim());
        if (!Number.isFinite(value))
            continue;
        if (key === "rx_bytes")
            rx += value;
        else if (key === "tx_bytes")
            tx += value;
    }
    return { rx, tx };
}
/** Идёт ли через туннель весь трафик (в профиле есть маршрут по умолчанию). */
function routesEverything(parsed) {
    return parsed.peers.some((peer) => peer.allowedIps.some((cidr) => cidr === "0.0.0.0/0" || cidr === "::/0"));
}
/* ────────────────────── Настройка интерфейса ────────────────────── */
/** Адрес IPv6, если в строке есть двоеточие: `ip` требует разных семейств. */
function isV6(cidr) {
    return cidr.includes(":");
}
/**
 * Маска IPv4 из длины префикса: `32` → `255.255.255.255`.
 *
 * Нужна только Windows: `netsh` принимает маску, а не длину префикса, тогда как
 * в профиле адрес записан как `10.8.0.7/32`.
 */
function ipv4Mask(prefix) {
    const bits = Math.max(0, Math.min(32, Math.trunc(prefix)));
    const value = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join(".");
}
/** Хост точки подключения без порта (для обходного маршрута в macOS). */
function endpointHost(endpoint) {
    const trimmed = endpoint.trim();
    if (trimmed.startsWith("["))
        return trimmed.slice(1, trimmed.indexOf("]"));
    const colon = trimmed.lastIndexOf(":");
    return colon > 0 ? trimmed.slice(0, colon) : trimmed;
}
/**
 * FIX-ONLINK: подсеть туннеля для адреса вида `10.8.0.2/32`.
 *
 * Профиль выдаёт адрес одиночной маской `/32`. В Linux этого хватает: маршрут
 * до узла создаёт сам `wg`. В Windows не хватает — у интерфейса не остаётся
 * НИ ОДНОЙ своей подсети, а значит нет и ближайшего узла, через который
 * отправлять. Внешне это выглядело так: адрес `10.8.0.2` выдан, маршруты в
 * туннель стоят, а `ping 10.8.0.1` — сто процентов потерь, потому что до
 * второго конца туннеля попросту нет маршрута.
 *
 * Поэтому подсеть считаем сами: из префикса профиля, если он уже не `/32`, и
 * из `/24` в противном случае — узлы этого проекта всегда выдают адреса из
 * `10.8.0.0/24`. Маршрут ставится на сам интерфейс, чужой сети не трогает.
 */
function tunnelSubnetCidr(parsed) {
    for (const address of parsed.addresses) {
        if (isV6(address))
            continue;
        const [ip, prefixText] = address.split("/");
        if (!ip)
            continue;
        const octets = ip.split(".").map((part) => Number(part));
        if (octets.length !== 4 || octets.some((part) => !Number.isFinite(part)))
            continue;
        const prefix = prefixText === undefined ? 32 : Number(prefixText);
        const bits = Number.isFinite(prefix) && prefix > 0 && prefix < 32 ? Math.trunc(prefix) : 24;
        const value = (((octets[0] ?? 0) << 24) |
            ((octets[1] ?? 0) << 16) |
            ((octets[2] ?? 0) << 8) |
            (octets[3] ?? 0)) >>>
            0;
        const mask = (0xffffffff << (32 - bits)) >>> 0;
        const network = (value & mask) >>> 0;
        const base = [24, 16, 8, 0].map((shift) => (network >>> shift) & 0xff).join(".");
        return `${base}/${bits}`;
    }
    return null;
}
/**
 * FIX-PROBEGW: адрес второго конца туннеля — первый узел своей подсети.
 *
 * Нужен для проверки живости канала. Прежняя проверка спрашивала сервер имён из
 * профиля (`1.1.1.1`), и это работало только в режиме «весь трафик». В режиме
 * «только приложение» в туннель уходит одна подсеть `10.8.0.0/24`, а `1.1.1.1`
 * идёт мимо, через обычного провайдера. Проба уходила не в туннель, принятых
 * байт не появлялось, и через 25 секунд рабочее подключение объявлялось
 * сломанным и откатывалось. Адрес узла туннеля доступен в ЛЮБОМ режиме.
 */
function tunnelGatewayIp(parsed) {
    const subnet = tunnelSubnetCidr(parsed);
    if (!subnet)
        return null;
    const base = subnet.split("/")[0];
    if (!base)
        return null;
    const octets = base.split(".").map((part) => Number(part));
    if (octets.length !== 4 || octets.some((part) => !Number.isFinite(part)))
        return null;
    const last = (octets[3] ?? 0) + 1;
    if (last > 254)
        return null;
    return `${octets[0]}.${octets[1]}.${octets[2]}.${last}`;
}
/**
 * Команды, поднимающие интерфейс после запуска встроенного клиента: адрес,
 * MTU, маршруты. Это работа, которую раньше делал `wg-quick`; теперь её делаем
 * мы, потому что `wg-quick` — часть сторонних `wireguard-tools`.
 *
 * Используются только штатные утилиты ОС (`ip` в Linux, `ifconfig`/`route` в
 * macOS) — они есть в любой системе и ничего не требуют устанавливать.
 */
function ifaceUpCommands(platform, parsed, iface = vpnPlan_1.TUNNEL_NAME) {
    const commands = [];
    if (platform === "linux") {
        for (const address of parsed.addresses) {
            commands.push(["ip", isV6(address) ? "-6" : "-4", "address", "add", address, "dev", iface]);
        }
        /* FIX-MTU: MTU выставляется ВСЕГДА, а не только когда он есть в профиле. */
        commands.push(["ip", "link", "set", "mtu", String(safeMtu(parsed)), "dev", iface]);
        commands.push(["ip", "link", "set", iface, "up"]);
        return commands;
    }
    if (platform === "darwin") {
        for (const address of parsed.addresses) {
            const ip = address.split("/")[0] ?? address;
            commands.push(isV6(address)
                ? ["ifconfig", iface, "inet6", address, "alias"]
                : ["ifconfig", iface, "inet", ip, ip, "alias"]);
        }
        commands.push(["ifconfig", iface, "mtu", String(safeMtu(parsed))]);
        commands.push(["ifconfig", iface, "up"]);
        return commands;
    }
    if (platform === "win32") {
        /* Здесь роль `ip`/`ifconfig` играет штатный `netsh` — он есть в любой
           Windows, ставить ничего не нужно. `store=active` означает «до
           перезагрузки»: настройки исчезнувшего интерфейса не должны оставаться в
           реестре и всплывать при следующем запуске системы. */
        /* FIX-DAD: отключаем проверку занятости адреса и поиск маршрутизаторов.
    
           Windows по умолчанию проверяет каждый новый адрес на занятость соседями
           (DAD, три попытки) и держит его в состоянии Tentative до конца проверки.
           Отправлять с проверяемого адреса система НЕ БУДЕТ. В туннеле «точка —
           точка» соседей нет вовсе, проверять нечего, а секунды теряются ровно
           там, где мы ставим маршруты: замер показал адрес в состоянии Tentative
           через секунду после рукопожатия, то есть именно в момент переключения
           трафика. Итог выглядел как «маршруты есть, а трафик не идёт».
    
           Поиск маршрутизаторов выключаем по той же причине: в туннеле объявлять
           маршруты некому, а RouterDiscovery умеет подменять MTU и шлюз. */
        commands.push(["netsh", "interface", "ipv4", "set", "interface", `interface=${iface}`, "dadtransmits=0", "routerdiscovery=disabled", "store=active"]);
        commands.push(["netsh", "interface", "ipv6", "set", "interface", `interface=${iface}`, "dadtransmits=0", "routerdiscovery=disabled", "store=active"]);
        for (const address of parsed.addresses) {
            const [ip, prefix] = address.split("/");
            if (!ip)
                continue;
            if (isV6(address)) {
                commands.push(["netsh", "interface", "ipv6", "set", "address", `interface=${iface}`, `address=${address}`, "store=active"]);
            }
            else {
                const mask = ipv4Mask(prefix === undefined ? 32 : Number(prefix));
                commands.push([
                    "netsh", "interface", "ipv4", "set", "address",
                    `name=${iface}`, "source=static", `address=${ip}`, `mask=${mask}`, "store=active",
                ]);
            }
        }
        const mtu = safeMtu(parsed);
        commands.push(["netsh", "interface", "ipv4", "set", "subinterface", iface, `mtu=${mtu}`, "store=active"]);
        /* Тот же предел для IPv6: без него стек v6 продолжал бы считать себя вправе
           шлать пакеты по 1500 байт. */
        commands.push(["netsh", "interface", "ipv6", "set", "subinterface", iface, `mtu=${mtu}`, "store=active"]);
        return commands;
    }
    return commands;
}
/**
 * FIX-NOROUTE: маршруты и DNS туннеля — ОТДЕЛЬНО от подъёма интерфейса.
 *
 * Разделение сделано ради порядка действий, а не ради красоты. Пока эти
 * команды шли вместе с настройкой адреса, системная маршрутизация менялась до
 * того, как становилось известно, ответил ли узел вообще. Если не отвечал,
 * весь трафик уже был завёрнут в мёртвый туннель: интернета нет ни в
 * приложении, ни в браузере, ни в играх — и ��еловек оставался без сети, не
 * понимая причины. Теперь маршруты ставятся только после рукопожатия, и
 * самый плохой исход — «подключиться не удалось» при живом интернете.
 *
 * DNS тут же, а не в подъёме, по той же причине: сервер имён из профиля
 * доступен только внутри туннеля, и назначенный раньше срока он ломал разбор
 * имён ещё до появления связи.
 */
function ifaceRouteCommands(platform, parsed, iface = vpnPlan_1.TUNNEL_NAME) {
    const routeAll = routesEverything(parsed);
    const commands = [];
    if (platform === "linux") {
        if (routeAll) {
            /* Маршрут по умолчанию — в отдельной таблице, а не в main: так его видно
               только помеченным пакетам, и мы не затираем системный шлюз. Правило
               `suppress_prefixlength 0` возвращает в main всё, кроме маршрута по
               умолчанию, — иначе локальная сеть (принтеры, NAS) уехала бы в туннель. */
            commands.push(["ip", "-4", "route", "add", "0.0.0.0/0", "dev", iface, "table", String(exports.ROUTE_MARK)]);
            commands.push(["ip", "-4", "rule", "add", "not", "fwmark", String(exports.ROUTE_MARK), "table", String(exports.ROUTE_MARK)]);
            commands.push(["ip", "-4", "rule", "add", "table", "main", "suppress_prefixlength", "0"]);
            /* FIX-V6LEAK: режим «весь трафик» до этого забирал только IPv4. На любом
               канале с IPv6 (а это почти все мобильные и половина домашних) браузер
               предпочитает v6 — и весь трафик к крупным сайтам шёл МИМО туннеля,
               вместе с настоящим адресом человека. Проверка анонимности при этом
               честно показывала «VPN не обнаружен».
      
               Есть v6 внутри туннеля — маршрутизуем его так же, как v4. Нет — выбираем
               ОТКЛЮЧИТЬ v6 на время работы туннеля, а не оставить как есть: лучше
               сайт без v6 (браузер сам перейдёт на v4 за миллисекунды), чем тихая
               утечка адреса. Маршруты снимаются при выключении (ifaceDownCommands). */
            if (hasV6Tunnel(parsed)) {
                commands.push(["ip", "-6", "route", "add", "::/0", "dev", iface, "table", String(exports.ROUTE_MARK)]);
                commands.push(["ip", "-6", "rule", "add", "not", "fwmark", String(exports.ROUTE_MARK), "table", String(exports.ROUTE_MARK)]);
                commands.push(["ip", "-6", "rule", "add", "table", "main", "suppress_prefixlength", "0"]);
            }
            else {
                commands.push(["ip", "-6", "route", "add", "blackhole", "::/1"]);
                commands.push(["ip", "-6", "route", "add", "blackhole", "8000::/1"]);
            }
        }
        /* Частичный режим («только сервисы»): подсети из профиля — обычными
           маршрутами. Маршрут по умолчанию здесь не нужен, метка тоже. */
        for (const peer of parsed.peers) {
            for (const cidr of peer.allowedIps) {
                if (cidr === "0.0.0.0/0" || cidr === "::/0")
                    continue;
                commands.push(["ip", isV6(cidr) ? "-6" : "-4", "route", "add", cidr, "dev", iface]);
            }
        }
        return commands;
    }
    if (platform === "darwin") {
        if (routeAll) {
            /* В macOS нет fwmark, поэтому от петли спасает точечный маршрут до самой
               точки подключения через прежний шлюз, а весь остальной трафик уходит в
               туннель двумя половинами (0/1 и 128/1): они «сильнее» маршрута по
               умолчанию, и системный шлюз при этом остаётся на месте. */
            for (const peer of parsed.peers) {
                if (!peer.endpoint)
                    continue;
                const host = endpointHost(peer.endpoint);
                if (host && !host.includes(":")) {
                    commands.push(["route", "-q", "-n", "add", "-inet", `${host}/32`, "-interface", "en0"]);
                }
            }
            commands.push(["route", "-q", "-n", "add", "-inet", "0.0.0.0/1", "-interface", iface]);
            commands.push(["route", "-q", "-n", "add", "-inet", "128.0.0.0/1", "-interface", iface]);
            /* FIX-V6LEAK: те же две половины для v6 — в туннель или в петлю (lo0),
               если v6 в туннеле нет. В петлю — именно потому, что в macOS нет
               «blackhole» для маршрутов, а отключать v6 целиком через networksetup
               значило бы менять настройки системы, переживающие перезагрузку. */
            const v6Target = hasV6Tunnel(parsed) ? iface : "lo0";
            commands.push(["route", "-q", "-n", "add", "-inet6", "::/1", "-interface", v6Target]);
            commands.push(["route", "-q", "-n", "add", "-inet6", "8000::/1", "-interface", v6Target]);
        }
        for (const peer of parsed.peers) {
            for (const cidr of peer.allowedIps) {
                if (cidr === "0.0.0.0/0" || cidr === "::/0")
                    continue;
                commands.push(["route", "-q", "-n", "add", isV6(cidr) ? "-inet6" : "-inet", cidr, "-interface", iface]);
            }
        }
        return commands;
    }
    if (platform === "win32") {
        /* DNS туннеля: без него в режиме «весь трафик» имена продолжали бы
           разрешаться прежним сервером — это утечка того, куда человек ходит. */
        parsed.dns.filter((server) => !isV6(server)).forEach((server, index) => {
            commands.push(index === 0
                ? ["netsh", "interface", "ipv4", "set", "dnsservers", `name=${iface}`, "static", server, "primary", "validate=no"]
                : ["netsh", "interface", "ipv4", "add", "dnsservers", `name=${iface}`, server, `index=${index + 1}`, "validate=no"]);
        });
        /* FIX-DNS6: серверы имён IPv6 тем же порядком. Раньше они просто
           отбрасывались фильтром, и при живом v6 имена продолжал разрешать
           сервер провайдера — та самая утечка DNS, только по другому семейству. */
        parsed.dns.filter((server) => isV6(server)).forEach((server, index) => {
            commands.push(index === 0
                ? ["netsh", "interface", "ipv6", "set", "dnsservers", `name=${iface}`, "static", server, "primary", "validate=no"]
                : ["netsh", "interface", "ipv6", "add", "dnsservers", `name=${iface}`, server, `index=${index + 1}`, "validate=no"]);
        });
        /* FIX-ONLINK: своя подсеть у интерфейса — до маршрутов в туннель. Без неё
           у адаптера нет ближайшего узла, и второй конец туннеля (`10.8.0.1`)
           недостижим: маршруты половин ведут в интерфейс, которому некому
           передать пакет. */
        const subnet = tunnelSubnetCidr(parsed);
        if (subnet) {
            commands.push(["netsh", "interface", "ipv4", "add", "route", subnet, `interface=${iface}`, "store=active"]);
        }
        if (routeAll) {
            /* Как и в macOS: две половины адресного пространства вместо маршрута по
               умолчанию. Они точнее `0.0.0.0/0`, поэтому забирают весь трафик, но
               системный шлюз остаётся на месте — и пакеты самого туннеля уходят
               через него, а не в себя же. Отдельная метка (fwmark) в Windows не
               нужна именно поэтому. */
            commands.push(["netsh", "interface", "ipv4", "add", "route", "0.0.0.0/1", `interface=${iface}`, "store=active"]);
            commands.push(["netsh", "interface", "ipv4", "add", "route", "128.0.0.0/1", `interface=${iface}`, "store=active"]);
            /* FIX-V6WIN: v6 тоже забирается целиком, но КУДА — зависит от того, есть
               ли v6 внутри туннеля.
      
               Раньше обе половины всегда указывали на туннель. При туннеле без
               v6-адреса это давало худший из исходов: система считала, что путь для
               IPv6 есть, отдавала пакеты в адаптер, а уйти они не могли. Приложения,
               предпочитающие v6 (а это почти всё современное), ждали таймаута на
               каждом соединении — то самое «интернет пропал». Теперь, как и в macOS,
               при туннеле без v6 обе половины уводятся в петлю: отказ приходит
               мгновенно, и система сразу переходит на v4. Утечки при этом нет —
               наружу через провайдера v6-трафик не идёт. */
            const v6Target = hasV6Tunnel(parsed) ? `interface=${iface}` : `interface=${exports.WIN_LOOPBACK_INDEX}`;
            commands.push(["netsh", "interface", "ipv6", "add", "route", "::/1", v6Target, "store=active"]);
            commands.push(["netsh", "interface", "ipv6", "add", "route", "8000::/1", v6Target, "store=active"]);
        }
        for (const peer of parsed.peers) {
            for (const cidr of peer.allowedIps) {
                if (cidr === "0.0.0.0/0" || cidr === "::/0")
                    continue;
                /* FIX-PROBEGW: своя подсеть уже добавлена выше (FIX-ONLINK). В режиме
                   «только приложение» она же приходит и в разрешённых адресах пира —
                   повтор давал в журнале отказ «этот объект уже существует» и мешал
                   читать настоящие ошибки. */
                if (cidr === subnet)
                    continue;
                commands.push([
                    "netsh", "interface", isV6(cidr) ? "ipv6" : "ipv4", "add", "route",
                    cidr, `interface=${iface}`, "store=active",
                ]);
            }
        }
        return commands;
    }
    return commands;
}
/**
 * Команды уборки. Интерфейс исчезает вместе с процессом клиента, но правила
 * маршрутизации в Linux живут отдельно — их надо снять руками, иначе после
 * выключения система продолжит искать маршрут в пустой таблице и часть трафика
 * молча никуда не пойдёт.
 *
 * Каждая команда допускает неуспех: снимать может быть уже нечего.
 */
function ifaceDownCommands(platform, iface = vpnPlan_1.TUNNEL_NAME) {
    if (platform === "linux") {
        return [
            ["ip", "-4", "rule", "del", "table", "main", "suppress_prefixlength", "0"],
            ["ip", "-4", "rule", "del", "not", "fwmark", String(exports.ROUTE_MARK), "table", String(exports.ROUTE_MARK)],
            ["ip", "-4", "route", "flush", "table", String(exports.ROUTE_MARK)],
            /* FIX-V6LEAK: снимаем и v6 — и маршрутизацию в туннель, и глушилки. Забытый
               blackhole оставил бы машину без IPv6 ПОСЛЕ выключения VPN — ровно такая
               же поломка сети, как оставшиеся маршруты половин. */
            ["ip", "-6", "rule", "del", "table", "main", "suppress_prefixlength", "0"],
            ["ip", "-6", "rule", "del", "not", "fwmark", String(exports.ROUTE_MARK), "table", String(exports.ROUTE_MARK)],
            ["ip", "-6", "route", "flush", "table", String(exports.ROUTE_MARK)],
            ["ip", "-6", "route", "del", "blackhole", "::/1"],
            ["ip", "-6", "route", "del", "blackhole", "8000::/1"],
            ["ip", "link", "del", "dev", iface],
        ];
    }
    if (platform === "darwin") {
        return [
            ["route", "-q", "-n", "delete", "-inet", "0.0.0.0/1"],
            ["route", "-q", "-n", "delete", "-inet", "128.0.0.0/1"],
            ["route", "-q", "-n", "delete", "-inet6", "::/1"],
            ["route", "-q", "-n", "delete", "-inet6", "8000::/1"],
            ["ifconfig", iface, "down"],
        ];
    }
    if (platform === "win32") {
        /* Сам интерфейс исчезает вместе с процессом клиента (Wintun удаляет
           адаптер), а вот маршруты половин надо снять явно: иначе после
           выключения система продолжит слать трафик в исчезнувший интерфейс —
           сеть «есть», но не работает. */
        return [
            ["netsh", "interface", "ipv4", "delete", "route", "0.0.0.0/1", `interface=${iface}`, "store=active"],
            ["netsh", "interface", "ipv4", "delete", "route", "128.0.0.0/1", `interface=${iface}`, "store=active"],
            /* FIX-V6LEAK: те же две половины для v6. Забытый маршрут в исчезнувший адаптер оставил бы
               машину без IPv6 ПОСЛЕ выключения VPN — тот же сценарий «интернет есть,
               но не работает», что и с половинами v4. */
            ["netsh", "interface", "ipv6", "delete", "route", "::/1", `interface=${iface}`, "store=active"],
            ["netsh", "interface", "ipv6", "delete", "route", "8000::/1", `interface=${iface}`, "store=active"],
            /* FIX-V6WIN: половины могли уйти в петлю (туннель без v6) — снимаем и их.
               Забытый маршрут в петлю оставил бы машину без IPv6 ПОСЛЕ выключения
               VPN, то есть ровно ту поломку, от которой мы уходим. Обе команды
               допускают неуспех: лишняя из них просто не найдёт, что удалять. */
            ["netsh", "interface", "ipv6", "delete", "route", "::/1", `interface=${exports.WIN_LOOPBACK_INDEX}`, "store=active"],
            ["netsh", "interface", "ipv6", "delete", "route", "8000::/1", `interface=${exports.WIN_LOOPBACK_INDEX}`, "store=active"],
            /* FIX-NOROUTE: и DNS. Если адаптер почему-то остался в системе, статический
               сервер имён из профиля продолжал бы отвечать тишиной на любой запрос. */
            ["netsh", "interface", "ipv4", "set", "dnsservers", `name=${iface}`, "dhcp", "validate=no"],
            /* FIX-DNS6: и серверы имён IPv6 — иначе они остались бы прописаны на интерфейсе. */
            ["netsh", "interface", "ipv6", "set", "dnsservers", `name=${iface}`, "dhcp", "validate=no"],
        ];
    }
    return [];
}
/**
 * Адрес UAPI встроенного клиента. Задан ��амой реализацией WireGuard, поэтому не
 * настраивается.
 *
 * В Windows это не файл, а именованный канал в защищённом префиксе: доступ к
 * нему есть только у администраторов, что и требуется — через этот канал
 * задаётся закрытый ключ. Проверять его существование через `existsSync`
 * нельзя (каналы там не видны как файлы) — только подключением.
 */
/**
 * Маршрут-исключение до точки подключения (нужен только в Windows).
 *
 * Зачем. В режиме «весь трафик» мы забираем всё двумя половинами
 * `0.0.0.0/1` и `128.0.0.0/1`. Под это правило попадают и пакеты САМОГО
 * клиента к VPN-узлу: он начинает отправлять их в туннель, который сам же и
 * поднимает. Получается замыкание, рукопожатия нет, туннель «включён» и не
 * работает. В Linux от этого спасает метка (fwmark), в macOS и здесь —
 * отдельный узкий маршрут до адреса узла через прежний шлюз.
 *
 * Индекс интерфейса, а не имя: имя физического адаптера может быть любым
 * («Ethernet», «Беспроводная сеть»), а индекс однозначен.
 */
function excludeRouteCommand(endpointIp, gateway, interfaceIndex) {
    return [
        "netsh", "interface", "ipv4", "add", "route", `${endpointIp}/32`,
        `interface=${interfaceIndex}`, `nexthop=${gateway}`, "store=active",
    ];
}
/** Снятие маршрута-исключения при выключении. */
function excludeRouteDeleteCommand(endpointIp, interfaceIndex) {
    return [
        "netsh", "interface", "ipv4", "delete", "route", `${endpointIp}/32`,
        `interface=${interfaceIndex}`, "store=active",
    ];
}
/**
 * Разбор ответа «шлюз индекс» о текущем маршруте по умолчанию.
 *
 * Вынесено в чистую функцию, потому что разбор вывода системной утилиты —
 * самое хрупкое место: пустой ответ должен давать `null`, а не «шлюз 0.0.0.0».
 */
function parseDefaultRoute(output) {
    const match = /(\d{1,3}(?:\.\d{1,3}){3})\s+(\d+)/.exec(output.trim());
    if (!match || !match[1] || !match[2])
        return null;
    if (match[1] === "0.0.0.0")
        return null;
    const interfaceIndex = Number(match[2]);
    if (!Number.isFinite(interfaceIndex) || interfaceIndex <= 0)
        return null;
    return { gateway: match[1], interfaceIndex };
}
function uapiSocketPath(platform, iface = vpnPlan_1.TUNNEL_NAME) {
    if (platform === "win32") {
        return `\\\\.\\pipe\\ProtectedPrefix\\Administrators\\WireGuard\\${iface}`;
    }
    return `/var/run/wireguard/${iface}.sock`;
}
//# sourceMappingURL=vpnEmbedded.js.map