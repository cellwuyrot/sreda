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

import { TUNNEL_NAME } from "./vpnPlan";

/** Без чего клиент на Windows не работает вообще. */
export const WIN_CLIENT_REQUIRED = ["amneziawg.exe"] as const;

/**
 * Библиотеки драйвера и службы туннеля. Собраны списком, а не по одной:
 * разные сборки клиента называют их по-разному, а ставить сборку в зависимость от
 * одного имени — значит снова получить тихую сборку-пустышку.
 */
export const WIN_CLIENT_OPTIONAL = [
  "wintun.dll",
  "tunnel.dll",
  "amneziawg.dll",
  "amneziawg-nt.dll",
  "wireguard.dll",
  "awg.exe",
] as const;

/** Что из обязательного не нашлось среди имён файлов каталога. */
export function missingClientFiles(present: readonly string[]): string[] {
  const have = new Set(present.map((name) => name.toLowerCase()));
  return WIN_CLIENT_REQUIRED.filter((name) => !have.has(name.toLowerCase()));
}

/**
 * Каталог, откуда служба туннеля будет запускать клиента.
 *
 * `%ProgramData%` выбран нарочно: каталог один на машину, читаем системой,
 * переживает обновление приложения и не содержит ни пробелов, ни имени
 * пользователя — три причины, по которым служба раньше не стартовала.
 */
export function stableClientDir(env: Record<string, string | undefined> = {}): string {
  const base = env["ProgramData"] || env["ALLUSERSPROFILE"] || "C:\\ProgramData";
  return `${base}\\TrioZ\\vpn`;
}

/** Где может лежать клиент, установленный в системе отдельно. */
export function systemClientCandidates(env: Record<string, string | undefined> = {}): string[] {
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
export function serviceNames(tunnel: string = TUNNEL_NAME): string[] {
  return [`AmneziaWGTunnel$${tunnel}`, `WireGuardTunnel$${tunnel}`];
}

/**
 * Обяснение для человека, когда служба установлена, но не стартует.
 * Текст один на все пути отказа: разные формулировки одной беды только мешают
 * поддержке.
 */
export const WIN_SERVICE_HINT =
  "Служба туннеля не запустилась. Закройте сторонние VPN-клиенты и повторите включение; " +
  "если оно не помогло — перезагрузите компьютер.";
