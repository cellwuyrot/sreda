"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.HANDSHAKE_FRESH_SECONDS = exports.TUNNEL_CONF_FILE = exports.TUNNEL_NAME = void 0;
exports.tunnelBackendCandidates = tunnelBackendCandidates;
exports.tunnelUpArgs = tunnelUpArgs;
exports.tunnelDownArgs = tunnelDownArgs;
exports.elevatedInvocation = elevatedInvocation;
exports.handshakeQuery = handshakeQuery;
exports.parseLatestHandshake = parseLatestHandshake;
/**
 * Имя туннеля. Одно на приложение: на аккаунт работает ровно одно подключение
 * (сервер заменяет ключ при перевыпуске), поэтому и второй интерфейс не нужен.
 *
 * Ограничения имени берём по самому строгому из целевых: имя сетевого
 * интерфейса в Linux — до 15 символов, буквы/цифры/дефис. «trioz» проходит
 * везде и совпадает с именем файла конфигурации, из которого Windows выводит имя
 * службы `WireGuardTunnel$trioz`.
 */
exports.TUNNEL_NAME = "trioz";
/** Имя файла профиля. wg-quick и wireguard.exe выводят имя туннеля из него. */
exports.TUNNEL_CONF_FILE = `${exports.TUNNEL_NAME}.conf`;
/**
 * Кандидаты-бинарники в порядке приоритета для платформы и типа профиля.
 *
 * Обфусцированный профиль обычным WireGuard поднять нельзя (демон не поймёт
 * лишние ключи), поэтому запасного варианта «обычный wg» для него нет: лучше
 * честная ошибка «поставьте AmneziaWG», чем молчаливый обычный туннель вместо
 * маскированного.
 */
function tunnelBackendCandidates(platform) {
    /* FIX-AWG-ONLY: обычный WireGuard из клиента убран. Он не «второй вариант на
       случай чего-то»: узлы проекта поднимают только AmneziaWG, и попытка
       подключиться обычным клиентом заканчивается ровно тем, на что
       жаловались: адаптер есть, трафика нет, ошибки нет. Аргумент obfuscated
       убран совсем: профиль без параметров маскировки AmneziaWG поднимает как
       обычный WireGuard сам, отдельный бинарник для этого не нужен. */
    if (platform === "win32")
        return [{ exe: "amneziawg.exe", backend: "amneziawg" }];
    // Linux и macOS: инструменты из amneziawg-tools.
    return [{ exe: "awg-quick", backend: "amneziawg" }];
}
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
function tunnelUpArgs(platform, confPath) {
    if (platform === "win32")
        return ["/installtunnelservice", confPath];
    return ["up", confPath];
}
/**
 * Аргументы снятия туннеля.
 *
 * Windows снимает службу по её имени (`/uninstalltunnelservice <name>`), а
 * wg-quick — по тому же профилю, что и поднимал. Путь к профилю, а не имя
 * интерфейса, потому что файл лежит во временной папке приложения, а не в
 * `/etc/wireguard`, и по имени wg-quick его бы не нашёл.
 */
function tunnelDownArgs(platform, confPath, name = exports.TUNNEL_NAME) {
    if (platform === "win32")
        return ["/uninstalltunnelservice", name];
    return ["down", confPath];
}
/** Экранирование одинарных кавычек для одинарно-кавыченной строки PowerShell. */
function psQuote(value) {
    return `'${value.replace(/'/g, "''")}'`;
}
/** Экранирование для строки внутри двойных кавычек AppleScript (`do shell script`). */
function osaQuote(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
/** Одинарно-кавыченный аргумент POSIX-shell (для строки внутри osascript). */
function shQuote(value) {
    return `'${value.replace(/'/g, "'\\''")}'`;
}
function elevatedInvocation(platform, exe, args, options = {}) {
    const envPairs = Object.entries(options.env ?? {});
    if (platform === "win32") {
        /* Start-Process -Verb RunAs поднимает окно UAC; -Wait + $p.ExitCode
           пробрасывают код возврата, иначе успех и провал выглядели бы одинаково.
    
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
        const script = `$ErrorActionPreference='Stop';` +
            envPrefix +
            `$p = Start-Process -FilePath ${psQuote(exe)}${startArgs} ` +
            `-Verb RunAs -WindowStyle Hidden -PassThru -Wait; exit $p.ExitCode`;
        return {
            file: "powershell.exe",
            args: ["-NoProfile", "-NonInteractive", "-Command", script],
        };
    }
    if (platform === "darwin") {
        /* osascript просит пароль администратора системным окном. Команда сначала
           собирается как POSIX-shell строка (аргументы в одинарных кавычках), затем
           вся строка экранируется для двойных кавычек AppleScript. */
        const envPrefix = envPairs.map(([k, v]) => `${k}=${shQuote(v)}`);
        const command = [...envPrefix, ...[exe, ...args].map(shQuote)].join(" ");
        const script = `do shell script "${osaQuote(command)}" with administrator privileges`;
        return { file: "osascript", args: ["-e", script] };
    }
    /* Linux: pkexec принимает argv напрямую (без shell), поэтому кавычек не нужно.
       Но окружение он вычищает, так что переменные передаём через `env`. */
    if (envPairs.length) {
        const assignments = envPairs.map(([k, v]) => `${k}=${v}`);
        return { file: "pkexec", args: ["env", ...assignments, exe, ...args] };
    }
    return { file: "pkexec", args: [exe, ...args] };
}
/**
 * STATUS: аргументы к `wg`/`awg` для чтения времени последнего рукопожатия.
 *
 * `wg show <iface> latest-handshakes` печатает строки «<pubkey>\t<unix>».
 * Ноль означает «рукопожатия ещё не было», то есть туннель поднят, но связь с
 * сервером не установлена — по этому и отличаем `connecting` от `on`.
 */
function handshakeQuery(platform, backend, name = exports.TUNNEL_NAME) {
    /* FIX-AWG-ONLY: состояние читается только инструментом awg. */
    void backend;
    const tool = "awg";
    const exe = platform === "win32" ? `${tool}.exe` : tool;
    return { exe, args: ["show", name, "latest-handshakes"] };
}
/**
 * Максимальное время последнего рукопожатия (в секундах Unix) из вывода
 * `wg show … latest-handshakes`. Возвращает 0, если рукопожатий ещё не было или
 * вывод пуст/непонятен — вызывающий трактует 0 как «поднят, но не на связи».
 */
function parseLatestHandshake(output) {
    let max = 0;
    for (const line of output.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2)
            continue;
        const unix = Number(parts[parts.length - 1]);
        if (Number.isFinite(unix) && unix > max)
            max = unix;
    }
    return max;
}
/** Рукопожатие «свежее», если было не давнее этого окна (сек). Совпадает с
 *  порогом «туннель активен» в веб-части (3 минуты). */
exports.HANDSHAKE_FRESH_SECONDS = 180;
//# sourceMappingURL=vpnPlan.js.map