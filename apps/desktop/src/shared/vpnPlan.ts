/**
 * VPN-ONECLICK: чистая логика управления туннелем WireGuard/AmneziaWG.
 *
 * Здесь нет ни electron, ни child_process, ни файловой системы — только
 * построение команд и разбор вывода. Так сделано намеренно: вся ошибкоопасная
 * часть (кавычки при повышении прав, выбор бинарника, разбор рукопожатия) живёт
 * в модуле без побочных эффектов и целиком закрыта тестами. Запуск процессов и
 * запись файла с приватным ключом — в `main/vpn.ts`, там проверять уже нечего,
 * кроме прав ОС, которых в тестовой среде всё равно нет.
 *
 * Почему туннель поднимает именно оболочка, а не веб-страница: вкладка браузера
 * физически не имеет доступа к сетевому стеку ОС. Единственный клиент проекта с
 * таким доступом — десктоп-оболочка на Electron: у неё есть main-процесс на
 * Node. Поэтому «кнопка Вкл» реально работает здесь, а браузер лишь показывает,
 * что подключение живёт в приложении.
 */
​
/**
 * Имя туннеля. Одно на приложение: на аккаунт работает ровно одно подключение
 * (сервер заменяет ключ при перевыпуске), поэтому и второй интерфейс не нужен.
 *
 * Ограничения имени берём по самому строгому из целевых: имя сетевого
 * интерфейса в Linux — до 15 символов, буквы/цифры/дефис. «trioz» проходит
 * везде и совпадает с именем файла конфигурации, из которого Windows выводит имя
 * службы `WireGuardTunnel$trioz`.
 */
export const TUNNEL_NAME = "trioz";
​
/** Имя файла профиля. wg-quick и wireguard.exe выводят имя туннеля из него. */
export const TUNNEL_CONF_FILE = `${TUNNEL_NAME}.conf`;
​
/** Состояние подключения, как его видит и оболочка, и веб-часть. */
export type VpnConnState = "off" | "connecting" | "on" | "disconnecting" | "error";
​
/** Каким стеком поднят туннель: обычный WireGuard или обфусцированный AmneziaWG. */
export type VpnBackend = "wireguard" | "amneziawg";
​
/** То, что main-процесс шлёт в renderer при каждом изменении состояния. */
export interface VpnStatePayload {
  state: VpnConnState;
  /** ISO-время, когда туннель поднялся (для `on`), иначе null. */
  since: string | null;
  /** Человекочитаемая причина (для `error`), иначе null. */
  error: string | null;
  /** Чем реально подняли туннель, если он поднят; иначе null. */
  backend: VpnBackend | null;
  /**
   * VPN-EMBEDDED: поднят ли туннель ВСТРОЕННЫМ в приложение клиентом.
   *
   * Нужно ровно для одного: показать в интерфейсе, что скачивать и ставить
   * ничего не требуется. Поле необязательное, чтобы старые сборки оболочки,
   * которые его не присылают, продолжали работать со свежей веб-частью.
   */
  embedded?: boolean;
}
​
/**
 * Ключи секции `[Interface]`, которых у обычного WireGuard не бывает: их
 * добавляет только AmneziaWG для маскировки трафика. Их присутствие в профиле —
 * единственный признак, по которому клиент понимает, что поднимать туннель надо
 * обфусцированным стеком (`awg-quick` / `amneziawg.exe`), а не обычным.
 *
 * Список совпадает с тем, что читает агент узла (`apps/vpn/src/index.mjs`,
 * `PARAM_KEYS`) и что вписывает в профиль веб-часть (`lib/wgKeys.ts`,
 * `EXTRA_ORDER`) — три места обязаны держать один набор.
 */
const OBFUSCATION_KEYS = new Set([
  "Jc", "Jmin", "Jmax",
  "S1", "S2", "S3", "S4",
  "H1", "H2", "H3", "H4",
  "I1", "I2", "I3", "I4", "I5",
]);
​
/**
 * Обфусцирован ли профиль. Разбираем построчно и смотрим только имя ключа слева
 * от `=`: искать подстроки в тексте нельзя — «S1» мелькнёт в base64 любого
 * ключа, и обычный профиль ошибочно поехал бы на AmneziaWG.
 */
export function isObfuscatedConfig(config: string): boolean {
  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("[")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (OBFUSCATION_KEYS.has(key)) return true;
  }
  return false;
}
​
/** Один вариант бинарника, которым можно поднять туннель. */
export interface TunnelBackendCandidate {
  /** Базовое имя исполняемого файла (без пути); путь ищет main-процесс. */
  exe: string;
  backend: VpnBackend;
}
​
/**
 * Кандидаты-бинарники в порядке приоритета для платформы и типа профиля.
 *
 * Обфусцированный профиль обычным WireGuard поднять нельзя (демон не поймёт
 * лишние ключи), поэтому запасного варианта «обычный wg» для него нет: лучше
 * честная ошибка «поставьте AmneziaWG», чем молчаливый обычный туннель вместо
 * маскированного.
 */
export function tunnelBackendCandidates(
  platform: NodeJS.Platform,
  obfuscated: boolean,
): TunnelBackendCandidate[] {
  if (platform === "win32") {
    return obfuscated
      ? [{ exe: "amneziawg.exe", backend: "amneziawg" }]
      : [{ exe: "wireguard.exe", backend: "wireguard" }];
  }
  // Linux и macOS: инструменты из wireguard-tools / amneziawg-tools.
  return obfuscated
    ? [{ exe: "awg-quick", backend: "amneziawg" }]
    : [{ exe: "wg-quick", backend: "wireguard" }];
}
​
/**
 * Аргументы поднятия туннеля (без самого бинарника).
 *
 * Windows: `wireguard.exe /installtunnelservice <conf>` ставит и запускает
 * службу туннеля — это официальный способ встроить WireGuard, служба сама
 * скопирует профиль в защищённое хранилище (DPAPI). Имя службы берётся из имени
 * файла, поэтому файл обязан называться `<TUNNEL_NAME>.conf`.
 *
 * Linux/macOS: `wg-quick up <conf>` (или `awg-quick up <conf>`).
 */
export function tunnelUpArgs(platform: NodeJS.Platform, confPath: string): string[] {
  if (platform === "win32") return ["/installtunnelservice", confPath];
  return ["up", confPath];
}
​
/**
 * Аргументы снятия туннеля.
 *
 * Windows снимает службу по её имени (`/uninstalltunnelservice <name>`), а
 * wg-quick — по тому же профилю, что и поднимал. Путь к профилю, а не имя
 * интерфейса, потому что файл лежит во временной папке приложения, а не в
 * `/etc/wireguard`, и по имени wg-quick его бы не нашёл.
 */
export function tunnelDownArgs(
  platform: NodeJS.Platform,
  confPath: string,
  name: string = TUNNEL_NAME,
): string[] {
  if (platform === "win32") return ["/uninstalltunnelservice", name];
  return ["down", confPath];
}
​
/**
 * ELEVATE: как запустить `exe args…` с повышением прав на конкретной платформе.
 *
 * Возвращает уже готовую пару «файл + аргументы» для обычного spawn без shell.
 * Вся кавычечная арифметика собрана здесь и покрыта тестами: именно на ней
 * ломаются такие вещи, когда путь к профилю содержит пробел, а на Windows —
 * ещё и одинарную кавычку.
 */
export interface ElevatedInvocation {
  file: string;
  args: string[];
}
​
/** Дополнительные настройки запуска с повышением прав. */
export interface ElevatedOptions {
  /**
   * Переменные окружения, которые обязаны дойти до процесса под правами.
   *
   * Своё окружение такой процесс НЕ наследует: pkexec его вычищает по
   * соображениям безопасности, UAC и osascript запускают процесс из другого
   * сеанса. Поэтому переменные приходится вписывать в саму команду — без этого
   * `ELECTRON_RUN_AS_NODE` не дошёл бы, и наш же бинарник открыл бы окно
   * приложения от root вместо запуска сценария.
   */
  env?: Record<string, string>;
}
​
/** Экранирование одинарных кавычек для одинарно-кавыченной строки PowerShell. */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
​
/** Экранирование для строки внутри двойных кавычек AppleScript (`do shell script`). */
function osaQuote(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
​
/** Одинарно-кавыченный аргумент POSIX-shell (для строки внутри osascript). */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
​
export function elevatedInvocation(
  platform: NodeJS.Platform,
  exe: string,
  args: string[],
  options: ElevatedOptions = {},
): ElevatedInvocation {
  const envPairs = Object.entries(options.env ?? {});
​
  if (platform === "win32") {
    /* Start-Process -Verb RunAs поднимает окно UAC; -Wait + $p.ExitCode
       пробрасывают код возврата, иначе успех и провал выглядели бы одинаково.
​
       ВАЖНО про -ArgumentList. PowerShell НЕ добавляет кавычки вокруг
       элементов массива, содержащих пробелы: массив просто склеивается
       пробелами. Путь профиля лежит в каталоге с пробелом
       ("...\\TrioZ Connect\\vpn\\trioz.conf"), поэтому wireguard.exe получал
       ЛИШНИЕ аргументы, считал вызов неверным и печатал свой текст
       "Использование: ...". Поэтому список собираем как ОДНУ строку, в которой
       каждый аргумент уже обёрнут в двойные кавычки. */
    const quotedArgs = args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(" ");
    const startArgs = args.length ? ` -ArgumentList ${psQuote(quotedArgs)}` : "";
    /* Start-Process наследует окружение текущего процесса PowerShell, поэтому
       достаточно выставить переменные перед вызовом. */
    const envPrefix = envPairs.map(([k, v]) => `$env:${k}=${psQuote(v)};`).join("");
    const script =
      `$ErrorActionPreference='Stop';` +
      envPrefix +
      `$p = Start-Process -FilePath ${psQuote(exe)}${startArgs} ` +
      `-Verb RunAs -WindowStyle Hidden -PassThru -Wait; exit $p.ExitCode`;
    return {
      file: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command", script],
    };
  }
​
  if (platform === "darwin") {
    /* osascript просит пароль администратора системным окном. Команда сначала
       собирается как POSIX-shell строка (аргументы в одинарных кавычках), затем
       вся строка экранируется для двойных кавычек AppleScript. */
    const envPrefix = envPairs.map(([k, v]) => `${k}=${shQuote(v)}`);
    const command = [...envPrefix, ...[exe, ...args].map(shQuote)].join(" ");
    const script = `do shell script "${osaQuote(command)}" with administrator privileges`;
    return { file: "osascript", args: ["-e", script] };
  }
​
  /* Linux: pkexec принимает argv напрямую (без shell), поэтому кавычек не нужно.
     Но окружение он вычищает, так что переменные передаём через `env`. */
  if (envPairs.length) {
    const assignments = envPairs.map(([k, v]) => `${k}=${v}`);
    return { file: "pkexec", args: ["env", ...assignments, exe, ...args] };
  }
  return { file: "pkexec", args: [exe, ...args] };
}
​
/**
 * STATUS: аргументы к `wg`/`awg` для чтения времени последнего рукопожатия.
 *
 * `wg show <iface> latest-handshakes` печатает строки «<pubkey>\t<unix>».
 * Ноль означает «рукопожатия ещё не было», то есть туннель поднят, но связь с
 * сервером не установлена — по этому и отличаем `connecting` от `on`.
 */
export function handshakeQuery(
  platform: NodeJS.Platform,
  backend: VpnBackend,
  name: string = TUNNEL_NAME,
): { exe: string; args: string[] } {
  const tool = backend === "amneziawg" ? "awg" : "wg";
  const exe = platform === "win32" ? `${tool}.exe` : tool;
  return { exe, args: ["show", name, "latest-handshakes"] };
}
​
/**
 * Максимальное время последнего рукопожатия (в секундах Unix) из вывода
 * `wg show … latest-handshakes`. Возвращает 0, если рукопожатий ещё не было или
 * вывод пуст/непонятен — вызывающий трактует 0 как «поднят, но не на связи».
 */
export function parseLatestHandshake(output: string): number {
  let max = 0;
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const unix = Number(parts[parts.length - 1]);
    if (Number.isFinite(unix) && unix > max) max = unix;
  }
  return max;
}
​
/** Рукопожатие «свежее», если было не давнее этого окна (сек). Совпадает с
 *  порогом «туннель активен» в веб-части (3 минуты). */
export const HANDSHAKE_FRESH_SECONDS = 180;
​