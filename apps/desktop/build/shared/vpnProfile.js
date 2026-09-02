"use strict";
/**
 * VPN-AWG-ONLY: раскладка клиента AmneziaWG и разбор профиля.
 *
 * Файл заменил прежний `vpnEmbedded.ts` на 872 строки. Тот существовал ради
 * самописного бэкенда «wireguard-go + Wintun + netsh»: команды netsh, расчёт
 * маршрутов 0.0.0.0/1 и 128.0.0.0/1, UAPI-сокеты, поиск wintun.dll. Именно тот
 * код и был источником неработающего режима «Весь интернет». Своего поднятия
 * адаптера в проекте больше нет — туннель поднимает клиент AmneziaWG.
 *
 * Осталось ровно то, что нужно живому пути: где искать бинарник клиента и
 * проверка, что переданный профиль не битый.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMBEDDED_DIR = void 0;
exports.embeddedClientName = embeddedClientName;
exports.parseWgConfig = parseWgConfig;
exports.isUsableConfig = isUsableConfig;
exports.hasObfuscation = hasObfuscation;
/**
 * Подкаталог ресурсов сборки, куда `scripts/vendor-wireguard.mjs` кладёт клиента.
 *
 * Имя историческое (`wireguard`) и оставлено нарочно: оно связано с
 * `extraResources` в конфиге electron-builder и с уже установленными сборками:
 * переименование ради красоты сломало бы поиск клиента в установленном приложении.
 */
exports.EMBEDDED_DIR = "wireguard";
/**
 * Имя файла клиента для платформы.
 *
 * Развилки по стеку больше нет. Раньше при backend === "wireguard" искался
 * `wireguard.exe`, которого в сборке нет, и приложение сообщало «встроенный
 * клиент отсутствует». Аргумент backend оставлен в подписи только для
 * совместимости вызовов и ни на что не влияет.
 */
function embeddedClientName(platform, _backend) {
    if (platform === "win32")
        return "amneziawg.exe";
    return "awg-quick";
}
/** Значения `AllowedIPs` и `DNS` перечисляются через запятую. */
function splitList(value) {
    return value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
}
/** Ключи маскировки AmneziaWG — тот же набор, что у агента узла и веб-части. */
const OBFUSCATION_KEYS = new Set([
    "jc", "jmin", "jmax",
    "s1", "s2", "s3", "s4",
    "h1", "h2", "h3", "h4",
    "i1", "i2", "i3", "i4", "i5",
]);
/**
 * Разбор профиля в структуру. Нужен ради одного: до окна повышения прав
 * понять, что профиль не битый.
 *
 * Строка делится по ПЕРВОМУ знаку равенства: base64-ключ сам содержит `=`
 * на конце, и деление по всем `=` портило бы ключ — оттуда же бралась ошибка
 * вида «illegal base64 data at input byte 0».
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
            const end = line.indexOf("]");
            const name = line.slice(1, end === -1 ? undefined : end).toLowerCase();
            closePeer();
            if (name === "interface") {
                section = "interface";
            }
            else if (name === "peer") {
                section = "peer";
                peer = {
                    publicKey: "",
                    presharedKey: null,
                    endpoint: null,
                    allowedIps: [],
                    persistentKeepalive: null,
                };
            }
            else {
                section = "none";
            }
            continue;
        }
        const eq = line.indexOf("=");
        if (eq <= 0)
            continue;
        const key = line.slice(0, eq).trim().toLowerCase();
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
            else if (OBFUSCATION_KEYS.has(key))
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
/** Профиль пригоден, только если есть свой ключ, адрес и пир с точкой подключения. */
function isUsableConfig(parsed) {
    return (parsed.privateKey.length > 0 &&
        parsed.addresses.length > 0 &&
        parsed.peers.some((p) => p.publicKey.length > 0 && !!p.endpoint));
}
/**
 * Есть ли в профиле параметры маскировки. Профиль без них формально верен,
 * но на маскированном узле такое рукопожатие отбрасывается молча — именно так
 * выглядела поломка «туннель поднят, связи с VPN-узлом нет».
 */
function hasObfuscation(parsed) {
    return Object.keys(parsed.extra).length > 0;
}
//# sourceMappingURL=vpnProfile.js.map