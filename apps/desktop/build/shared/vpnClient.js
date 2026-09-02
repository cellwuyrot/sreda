"use strict";
/**
 * FIX-WINCLIENT: где лежит клиент туннеля и что ему нужно для службы Windows.
 *
 * Почему этот файл вообще появился. На Windows туннель поднимает не наш
 * процесс, а служба, которую создаёт `клиент.exe /installtunnelservice`.
 * Служба запоминает АБСОЛЮТНЫЕ пути к самому клиенту и к файлу профиля и
 * запускается от имени системы, а не от имени человека. Отсюда две беды
 * прежней сборки:
 *
 *  1. Клиент брался прямо из ресурсов приложения, а оно устанавливается в профиль
 *     пользователя (`C:\Users\<Имя>\AppData\Local\Programs\TrioZ Connect\resources\…`).
 *     Такой путь живёт ровно до следующего обновления, содержит пробел и
 *     часто нелатинское имя учётной записи. Служба в таком случае стартует и тут
 *     же падает с «Системе не удаётся найти указанный путь», а приложение
 *     показывало ровно то, на что жалуются люди: «туннель поднят, связи с
 *     узлом нет».
 *  2. Рядом с `amneziawg.exe` в сборку не клали ничего больше, хотя службе
 *     туннеля нужны его библиотеки драйвера. У автора проекта всё работало
 *     только потому, что на его машине уже был установлен полный клиент и служба
 *     один раз была поставлена вручную — то есть автоматического сценария в
 *     приложении фактически не было ни у кого.
 *
 * Здесь — только чистые функции без работы с диском и процессами: их можно
 * проверять тестами на любой платформе. Вся грязная работа — в `main/winTunnel.ts`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WIN_SERVICE_HINT = exports.WIN_CLIENT_OPTIONAL = exports.WIN_CLIENT_REQUIRED = void 0;
exports.missingClientFiles = missingClientFiles;
exports.stableClientDir = stableClientDir;
exports.systemClientCandidates = systemClientCandidates;
exports.serviceNames = serviceNames;
const vpnPlan_1 = require("./vpnPlan");
/** Без чего клиент на Windows не работает вообще. */
exports.WIN_CLIENT_REQUIRED = ["amneziawg.exe"];
/**
 * Библиотеки драйвера и службы туннеля. Собраны списком, а не по одной:
 * разные сборки клиента называют их по-разному, а ставить сборку в зависимость от
 * одного имени — значит снова получить тихую сборку-пустышку.
 */
exports.WIN_CLIENT_OPTIONAL = [
    "wintun.dll",
    "tunnel.dll",
    "amneziawg.dll",
    "amneziawg-nt.dll",
    "wireguard.dll",
    "awg.exe",
];
/** Что из обязательного не нашлось среди имён файлов каталога. */
function missingClientFiles(present) {
    const have = new Set(present.map((name) => name.toLowerCase()));
    return exports.WIN_CLIENT_REQUIRED.filter((name) => !have.has(name.toLowerCase()));
}
/**
 * Каталог, откуда служба туннеля будет запускать клиента.
 *
 * `%ProgramData%` выбран нарочно: каталог один на машину, читаем системой,
 * переживает обновление приложения и не содержит ни пробелов, ни имени
 * пользователя — три причины, по которым служба раньше не стартовала.
 */
function stableClientDir(env = {}) {
    const base = env["ProgramData"] || env["ALLUSERSPROFILE"] || "C:\\ProgramData";
    return `${base}\\TrioZ\\vpn`;
}
/** Где может лежать клиент, установленный в системе отдельно. */
function systemClientCandidates(env = {}) {
    const pf = env["ProgramFiles"] || "C:\\Program Files";
    const pf86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    return [
        `${pf}\\AmneziaWG\\amneziawg.exe`,
        `${pf}\\Amnezia\\AmneziaWG\\amneziawg.exe`,
        `${pf}\\AmneziaVPN\\amneziawg.exe`,
        `${pf86}\\AmneziaWG\\amneziawg.exe`,
        `${pf}\\WireGuard\\wireguard.exe`,
        `${pf86}\\WireGuard\\wireguard.exe`,
    ];
}
/**
 * Имена службы туннеля. Форк с маскировкой регистрирует одно имя, обычный
 * WireGuard — другое. Привязка к одному давала ложное «туннель не поднят».
 */
function serviceNames(tunnel = vpnPlan_1.TUNNEL_NAME) {
    return [`AmneziaWGTunnel$${tunnel}`, `WireGuardTunnel$${tunnel}`];
}
/**
 * Обяснение для человека, когда служба установлена, но не стартует.
 * Текст один на все пути отказа: разные формулировки одной беды только мешают
 * поддержке.
 */
exports.WIN_SERVICE_HINT = "Служба туннеля не запустилась. Закройте сторонние VPN-клиенты и повторите включение; " +
    "если оно не помогло — перезагрузите компьютер.";
//# sourceMappingURL=vpnClient.js.map