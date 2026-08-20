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
import { lookup } from "node:dns/promises";
import { connect } from "node:net";
import {
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
  ifaceUpCommands,
  isUsableConfig,
  parseDefaultRoute,
  parseUapiHandshake,
  parseWgConfig,
  routesEverything,
  uapiSetRequest,
  uapiSocketPath,
} from "../shared/vpnEmbedded";

/** Файл с PID запущенного клиента — лежит рядом с профилем. */
export const PID_FILE = `${TUNNEL_NAME}.pid`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** Запуск штатной утилиты ОС. `required: false` — неуспех допустим (уборка). */
function runTool(command: string[], required: boolean): void {
  const [file, ...args] = command;
  if (!file) return;
  const result = spawnSync(file, args, { encoding: "utf8", timeout: 20_000 });
  if (required && (result.error || result.status !== 0)) {
    const detail = (result.stderr || result.error?.message || "").trim();
    fail(`Не удалось настроить сетевой интерфейс (${file}): ${detail || "неизвестная ошибка"}`);
  }
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
 * FIX-WINTUN: журнал встроенного клиента.
 *
 * Раньше вывод клиента уходил в `stdio: "ignore"`, и любая его беда выглядела
 * одинаково: «клиент не успел поднять сетевое устройство». Причина же почти
 * всегда конкретна и написана самим клиентом в первой строке: не загрузилась
 * `wintun.dll`, нет прав администратора, адаптер занят прежним процессом.
 * Теперь вывод пишется рядом с профилем и попадает в текст ошибки.
 */
export const CLIENT_LOG = `${TUNNEL_NAME}-client.log`;

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
 * клиентом). Копировать пытаемся в папку клиента — так надёжнее всего, ведь
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
      /* короткая пауза без таймеров: работник живёт ровно один сценарий */
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

  const pidPath = join(dirname(confPath), PID_FILE);
  killPrevious(pidPath);

  const socketPath = uapiSocketPath(process.platform);
  const clientDir = dirname(clientPath);

  let extraPathDir = "";
  if (process.platform === "win32") {
    /* Сетевое устройство в Windows создаёт wintun.dll, которую загружает сам
       клиент. Если её нет рядом с клиентом — ищем установленную в системе и
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
      /* Подробный журнал — он и объясняет отказы создания адаптера. */
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

  for (const command of ifaceUpCommands(process.platform, parsed)) {
    /* В Windows обязательны ВСЕ шаги, включая маршруты и DNS: тихо провалившийся
       `netsh add route` давал ровно тот случай «включено, а трафик идёт напрямую». */
    const critical =
      process.platform === "win32" ||
      command.includes("address") ||
      command.includes("inet") ||
      command.includes("up");
    runTool(command, critical);
  }

  /* Главное: об успехе сообщаем только после реального рукопожатия с узлом.
     Инициатива здесь наша: keepalive в настройках заставляет клиента послать
     первый пакет сам, не дожидаясь пользовательского трафика. */
  await waitForHandshake(socketPath, 20_000);

  process.stdout.write("ok\n");
}

/** Снять туннель: убить клиента и убрать за ним правила маршрутизации. */
function down(confDir: string): void {
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
  process.stdout.write("ok\n");
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
