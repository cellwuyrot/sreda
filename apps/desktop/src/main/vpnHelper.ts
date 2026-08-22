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

import { spawn, spawnSync } from "node:child_process";
import { createSocket } from "node:dgram";
import { lookup } from "node:dns/promises";
import { connect } from "node:net";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { TUNNEL_NAME } from "../shared/vpnPlan";
import {
  WINTUN_DLL,
  wintunSearchDirs,
  endpointHost,
  excludeRouteCommand,
  excludeRouteDeleteCommand,
  ifaceDownCommands,
  ifaceRouteCommands,
  ifaceUpCommands,
  parseUapiTransfer,
  isUsableConfig,
  parseDefaultRoute,
  parseUapiHandshake,
  parseWgConfig,
  routesEverything,
  tunnelGatewayIp,
  uapiSetRequest,
  uapiSocketPath,
} from "../shared/vpnEmbedded";

/** Файл с PID запущенного клиента — лежит рядом с профилем. */
export const PID_FILE = `${TUNNEL_NAME}.pid`;

function fail(message: string): never {
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
let rollbackDir: string | null = null;
let tunnelReady = false;

process.on("exit", (code) => {
  if (code === 0 || tunnelReady || rollbackDir === null) return;
  try {
    down(rollbackDir, true);
  } catch {
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
const CP866_HIGH =
  "АБВГДЕЖЗИЙКЛМНОП" +
  "РСТУФХЦЧШЩЪЫЬЭЮЯ" +
  "абвгдежзийклмноп" +
  "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐" +
  "└┴┬├─┼╞╟╚╔╩╦╠═╬╧" +
  "╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀" +
  "рстуфхцчшщъыьэюя" +
  "ЁёЄєЇїЎў°∙·√№¤■ ";

/** Вывод системной утилиты в читаемом виде. */
export function decodeConsole(chunk: Buffer | string | null | undefined, platform = process.platform): string {
  if (chunk === null || chunk === undefined) return "";
  if (typeof chunk === "string") return chunk;
  if (platform !== "win32") return chunk.toString("utf8");
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
function runTool(command: string[], required: boolean): boolean {
  const [file, ...args] = command;
  if (!file) return true;
  /* FIX-OEM: без явного encoding получаем байты и сами переводим их из консольной
     кодовой страницы. С encoding: "utf8" ответ netsh превращался в мусор, и
     единственная важная часть сообщения была нечитаемой. */
  const result = spawnSync(file, args, { timeout: 20_000 });
  const text = `${decodeConsole(result.stdout)} ${decodeConsole(result.stderr)}`.replace(/\s+/g, " ").trim();
  /* FIX-SETUPLOG: в журнал попадает КАЖДЫЙ шаг, а не только упавший. Разбор
     этой поломки занял часы ровно потому, что успешные шаги были невидимы, и
     нельзя было понять, что и в каком порядке реально применилось. */
  logSetup(`${file} ${args.join(" ")} -> код ${result.status ?? "?"}${text ? ` | ${text}` : ""}`);
  if (!result.error && result.status === 0) return true;
  const lower = text.toLowerCase();
  if (HARMLESS_TOOL_ERRORS.some((phrase) => lower.includes(phrase))) return true;

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
function isCriticalStep(command: string[]): boolean {
  if (process.platform !== "win32") {
    return command.includes("address") || command.includes("inet") || command.includes("up");
  }
  if (command.includes("ipv6")) return false;
  if (command.includes("dnsservers")) return false;
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
function canConnect(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(path);
    const finish = (ok: boolean) => {
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
async function waitForUapi(
  path: string,
  timeoutMs: number,
  logPath: string,
  exited: () => number | null,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(path)) return;
    /* FIX-WINTUN: если клиент уже умер, ждать дальше бессмысленно — причина
       написана в его журнале, и человеку нужно показать именно её. */
    const code = exited();
    if (code !== null) {
      const tail = clientLogTail(logPath);
      fail(
        `Встроенный клиент не смог создать сетевой адаптер (код ${code}).` +
          (tail ? ` Клиент сообщает: ${tail}` : "") +
          ` Полный журнал: ${logPath}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const tail = clientLogTail(logPath);
  fail(
    "Встроенный клиент не успел поднять сетевое устройство." +
      (tail ? ` Клиент сообщает: ${tail}` : "") +
      ` Полный журнал: ${logPath}`,
  );
}

/** Отправить UAPI-запрос и вернуть ответ целиком. */
function uapiRequest(path: string, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
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
function assertUapiOk(response: string): void {
  const match = /errno=(-?\d+)/.exec(response);
  if (!match || match[1] === "0") return;
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
async function waitForHandshake(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (parseUapiHandshake(await uapiRequest(path, "get=1\n\n")) > 0) return;
    } catch {
      /* клиент занят — спросим ещё раз */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail(
    "Туннель поднят, но VPN-узел не ответил на рукопожатие. " +
      "Проверьте доступность сервера и актуальность профиля подключения.",
  );
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
async function readRx(path: string): Promise<number> {
  try {
    return parseUapiTransfer(await uapiRequest(path, "get=1\n\n")).rx;
  } catch {
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
function probeThroughTunnel(server: string): void {
  try {
    const socket = createSocket(server.includes(":") ? "udp6" : "udp4");
    /* Минимальный запрос DNS: заголовок, имя `ya.ru`, тип A. */
    const query = Buffer.from([
      0x7a, 0x69, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x02, 0x79, 0x61, 0x02, 0x72, 0x75, 0x00, 0x00, 0x01, 0x00, 0x01,
    ]);
    const close = () => {
      try {
        socket.close();
      } catch {
        /* уже закрыт */
      }
    };
    socket.on("error", close);
    socket.on("message", close);
    socket.send(query, 53, server, () => setTimeout(close, 2_000));
  } catch {
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
function pingProbe(target: string): boolean {
  const command =
    process.platform === "win32"
      ? ["ping", "-n", "1", "-w", "1500", target]
      : ["ping", "-c", "1", "-W", "2", target];
  const [file, ...args] = command;
  if (!file) return false;
  try {
    const result = spawnSync(file, args, { timeout: 5_000 });
    const text = `${decodeConsole(result.stdout)} ${decodeConsole(result.stderr)}`
      .replace(/\s+/g, " ")
      .trim();
    const answered = /ttl[=\s]*\d+/i.test(text);
    logSetup(`проба ${file} ${args.join(" ")} -> код ${result.status ?? "?"} | ответ: ${answered ? "есть" : "нет"}`);
    return answered;
  } catch {
    return false;
  }
}

async function waitForTraffic(
  path: string,
  timeoutMs: number,
  baseline: number,
  probeServers: string[],
  gateway: string | null,
): Promise<boolean> {
  const start = baseline >= 0 ? baseline : await readRx(path);
  const deadline = Date.now() + timeoutMs;
  let tick = 0;
  while (Date.now() < deadline) {
    const rx = await readRx(path);
    if (rx > start) return true;
    /* Раз в полторы секунды подталкиваем туннель своим запросом. */
    if (tick % 3 === 0) {
      for (const server of probeServers.slice(0, 2)) probeThroughTunnel(server);
      /* FIX-PROBEGW: главная проба — сам узел туннеля. Он внутри туннеля в обоих
         режимах, в отличие от сервера имён. */
      if (gateway && pingProbe(gateway)) return true;
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
export const CLIENT_LOG = `${TUNNEL_NAME}-client.log`;

/**
 * FIX-SETUPLOG: журнал шагов настройки сети — рядом с журналом клиента.
 *
 * Журнал клиента рассказывает про шифрование и рукопожатие, но ничего не знает
 * про адрес, маршруты и серверы имён — а ломается чаще всего именно это.
 */
export const SETUP_LOG = `${TUNNEL_NAME}-setup.log`;

let setupLogPath = "";

function logSetup(line: string): void {
  if (!setupLogPath) return;
  try {
    appendFileSync(setupLogPath, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* журнал не имеет права ломать подключение */
  }
}

/** Последние строки журнала клиента — для внятного сообщения об ошибке. */
function clientLogTail(logPath: string, lines = 6): string {
  try {
    return readFileSync(logPath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .slice(-lines)
      .join("; ");
  } catch {
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
function ensureWintun(clientDir: string): string {
  if (existsSync(join(clientDir, WINTUN_DLL))) return "";

  for (const dir of wintunSearchDirs(process.env)) {
    const candidate = join(dir, WINTUN_DLL);
    if (!existsSync(candidate)) continue;
    try {
      copyFileSync(candidate, join(clientDir, WINTUN_DLL));
      return "";
    } catch {
      return dir;
    }
  }

  fail(
    "Сетевой драйвер Wintun не найден: ни в ресурсах приложения, ни в системе. " +
      "Переустановите приложение или укажите путь к wintun.dll в переменной TRIOZ_WINTUN_DIR.",
  );
}

/**
 * FIX-WINTUN: дождаться, пока адаптер появится в сетевом стеке Windows.
 *
 * UAPI клиента открывается чуть раньше, чем система регистрирует адаптер под
 * своим именем, а `netsh` умеет работать только с уже зарегистрированным
 * именем. Без ожидания первый же `netsh set address` падал с «интерфейс не
 * найден» — и туннель оставался без адреса, то есть без связи.
 */
function waitForAdapter(iface: string, timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs;
  const script = `if (Get-NetAdapter -Name '${iface}' -ErrorAction SilentlyContinue) { "yes" }`;
  while (Date.now() < deadline) {
    const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      timeout: 20_000,
      windowsHide: true,
    });
    if ((result.stdout || "").includes("yes")) return true;
    const wait = Date.now() + 400;
    while (Date.now() < wait) {
      /* коро����кая пауза без таймеров: работник живёт ровно один сценарий */
    }
  }
  return false;
}

/** Файл с параметрами маршрута-исключения — чтобы снять его при выключении. */
export const EXCLUDE_FILE = `${TUNNEL_NAME}.exclude`;

/** Адрес узла: маршрут в Windows задаётся только IP, имя не подходит. */
async function resolveEndpointIp(endpoint: string): Promise<string> {
  const host = endpointHost(endpoint);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return host;
  const { address } = await lookup(host, { family: 4 });
  return address;
}

/** Текущий шлюз и интерфейс выхода в сеть до подъёма туннеля. */
function findDefaultRoute(): { gateway: string; interfaceIndex: number } | null {
  const script =
    "$r = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | " +
    "Where-Object { $_.NextHop -ne '0.0.0.0' } | Sort-Object RouteMetric | Select-Object -First 1; " +
    'if ($r) { "$($r.NextHop) $($r.InterfaceIndex)" }';
  const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    timeout: 20_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  return parseDefaultRoute(result.stdout || "");
}

/** Снять прежний клиент, если он ещё жив (после аварийного выхода). */
function killPrevious(pidPath: string): void {
  if (!existsSync(pidPath)) return;
  const pid = Number(readFileSync(pidPath, "utf8").trim());
  if (Number.isFinite(pid) && pid > 1) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* процесса уже нет — цель достигнута */
    }
  }
  try {
    rmSync(pidPath, { force: true });
  } catch {
    /* не мешает дальнейшему поднятию */
  }
}

/**
 * Поднять туннель: запустить встроенный клиент, настроить его по UAPI и
 * привести интерфейс в рабочее состояние штатными утилитами ОС.
 */
async function up(confPath: string, clientPath: string): Promise<void> {
  if (!existsSync(confPath)) fail("Профиль подключения не найден");
  if (!existsSync(clientPath)) fail("Встроенный клиент не найден в ресурсах приложения");

  const parsed = parseWgConfig(readFileSync(confPath, "utf8"));
  if (!isUsableConfig(parsed)) fail("Профиль подключения неполон: нет ключа, адреса или сервера");

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
    fail(
      "Профиль выдан для устойчивого к блокировкам режима (AmneziaWG), а в сборке есть только " +
        "клиент обычного WireGuard. Соберите приложение с amneziawg-go либо переведите узел в обычный режим.",
    );
  }
  if (!profileNeedsAwg && clientIsAwg) {
    /* Обратный случай безопасен: без параметров amneziawg-go ведёт себя как обычный
       WireGuard, но в журнале это должно быть видно. */
    process.stderr.write("[trioz] профиль без маскировки поднимается клиентом AmneziaWG\n");
  }

  const pidPath = join(dirname(confPath), PID_FILE);
  killPrevious(pidPath);
  /* С этой строки любой выход с ошибкой обязан вернуть сеть как было. */
  rollbackDir = dirname(confPath);

  /* FIX-SETUPLOG: с этого места каждый шаг настройки сети пишется в журнал. */
  setupLogPath = join(dirname(confPath), SETUP_LOG);
  try {
    writeFileSync(setupLogPath, "", { mode: 0o600 });
  } catch {
    /* журнал не имеет права ломать подключение */
  }

  const socketPath = uapiSocketPath(process.platform);
  const clientDir = dirname(clientPath);

  let extraPathDir = "";
  if (process.platform === "win32") {
    /* Сетевое устройство в Windows создаёт wintun.dll, которую загружает сам
       клиент. Если её нет рядом с клиентом — ищем установленную в с��стеме и
       подкладываем: иначе клиент падает на загрузке библиотеки, а человек
       видит лишь «адаптер не создан». */
    extraPathDir = ensureWintun(clientDir);
  } else {
    /* Каталог сокетов обычно создаёт сам клиент, но на чистой системе его
       может не быть, а без каталога клиент молча не поднимает UAPI. */
    try {
      mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
    } catch {
      /* уже есть — хорошо */
    }
    try {
      rmSync(socketPath, { force: true });
    } catch {
      /* старый сокет от аварийно умершего клиента мешать не должен */
    }
  }

  /* Клиент отвязывается от нашего процесса: он обязан пережить и этого
     работника, и перезапуск окна приложения. */
  const logPath = join(dirname(confPath), CLIENT_LOG);
  const logFd = openSync(logPath, "w");
  const child = spawn(clientPath, [TUNNEL_NAME], {
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
  let exitCode: number | null = null;
  child.on("exit", (code) => {
    exitCode = code ?? 0;
  });
  child.on("error", () => {
    exitCode = -1;
  });
  child.unref();
  if (typeof child.pid === "number") {
    writeFileSync(pidPath, `${child.pid}\n`, { mode: 0o600 });
  }

  await waitForUapi(socketPath, 20_000, logPath, () => exitCode);

  /* Адаптер должен быть виден системе под своим именем — только тогда с ним
     заработает `netsh`, то есть только тогда туннель получит адрес. */
  if (process.platform === "win32" && !waitForAdapter(TUNNEL_NAME, 15_000)) {
    const tail = clientLogTail(logPath);
    fail(
      `Сетевой адаптер «${TUNNEL_NAME}» не появился в системе.` +
        (tail ? ` Клиент сообщает: ${tail}` : "") +
        ` Полный журнал: ${logPath}`,
    );
  }

  const routeAll = routesEverything(parsed);
  let response: string;
  try {
    response = await uapiRequest(socketPath, uapiSetRequest(parsed, routeAll, process.platform));
  } catch (err) {
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
    if (!endpoint) fail("В профиле подключения нет адреса сервера");
    let endpointIp = "";
    try {
      endpointIp = await resolveEndpointIp(endpoint);
    } catch {
      fail("Не удалось определить адрес VPN-узла по его имени");
    }
    const gate = findDefaultRoute();
    if (!gate) {
      fail("Не удалось определить основной шлюз системы: без него туннель замкнётся сам на себя");
    }
    runTool(excludeRouteCommand(endpointIp, gate.gateway, gate.interfaceIndex), true);
    writeFileSync(join(dirname(confPath), EXCLUDE_FILE), `${endpointIp} ${gate.interfaceIndex}\n`, {
      mode: 0o600,
    });
  }

  /* Адрес и MTU — сразу: без адреса интерфейс не работает вовсе. Маршруты и
     DNS здесь сознательно НЕ ставятся — см. ниже. */
  for (const command of ifaceUpCommands(process.platform, parsed)) {
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

  for (const command of ifaceRouteCommands(process.platform, parsed)) {
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
  const gateway = tunnelGatewayIp(parsed);
  if (!(await waitForTraffic(socketPath, 25_000, trafficBaseline, routeAll ? parsed.dns : [], gateway))) {
    down(dirname(confPath), true);
    fail(
      "Узел ответил на рукопожатие, но обратный трафик через туннель не пошёл. " +
        "Маршруты и серверы имён возвращены на место — обычный интернет работает. " +
        `Что именно применялось: ${join(dirname(confPath), SETUP_LOG)}. ` +
        `Журнал клиента: ${logPath}`,
    );
  }

  /* Туннель работает: аварийная уборка больше не нужна — дальше маршруты
     снимает обычное выключение. */
  tunnelReady = true;
  process.stdout.write("ok\n");
}

/** Снять туннель: убить клиента и убрать за ним правила маршрутизации. */
function down(confDir: string, quiet = false): void {
  for (const command of ifaceDownCommands(process.platform)) runTool(command, false);
  /* Маршрут-исключение указывает на ФИЗИЧЕСКИЙ интерфейс и потому не исчезает
     вместе с туннелем — снимаем его по записанным при подъёме данным. */
  const excludePath = join(confDir, EXCLUDE_FILE);
  if (existsSync(excludePath)) {
    const [ip, index] = readFileSync(excludePath, "utf8").trim().split(/\s+/);
    if (ip && index) runTool(excludeRouteDeleteCommand(ip, Number(index)), false);
    try {
      rmSync(excludePath, { force: true });
    } catch {
      /* файл мог исчезнуть раньше — цель достигнута */
    }
  }
  killPrevious(join(confDir, PID_FILE));
  try {
    rmSync(uapiSocketPath(process.platform), { force: true });
  } catch {
    /* сокет исчезает вместе с клиентом */
  }
  if (!quiet) process.stdout.write("ok\n");
}

async function main(): Promise<void> {
  const [action, first, second] = process.argv.slice(2);
  if (action === "up") {
    if (!first || !second) fail("Неверные аргументы запуска туннеля");
    await up(first, second);
    return;
  }
  if (action === "down") {
    down(first || ".");
    return;
  }
  fail("Неизвестное действие");
}

void main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : "Неожиданная ошибка встроенного клиента");
});
