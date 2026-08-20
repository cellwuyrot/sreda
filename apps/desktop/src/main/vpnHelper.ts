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
import { connect } from "node:net";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { TUNNEL_NAME } from "../shared/vpnPlan";
import {
  ifaceDownCommands,
  ifaceUpCommands,
  isUsableConfig,
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
 * Дождаться UAPI-сокета клиента. Клиент создаёт его не мгновенно: сначала
 * поднимает TUN-устройство. Без ожидания настройка улетела бы в пустоту, и
 * туннель поднялся бы без ключей — то есть молча не работал.
 */
async function waitForSocket(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail("Встроенный клиент не успел поднять сетевое устройство");
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
  /* Каталог сокетов обычно создаёт сам клиент, но на чистой системе его может
     не быть, а без каталога клиент молча не поднимает UAPI. */
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

  /* Клиент отвязывается от нашего процесса: он обязан пережить и этого
     работника, и перезапуск окна приложения. */
  const child = spawn(clientPath, [TUNNEL_NAME], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, WG_PROCESS_FOREGROUND: "0" },
  });
  child.unref();
  if (typeof child.pid === "number") {
    writeFileSync(pidPath, `${child.pid}\n`, { mode: 0o600 });
  }

  await waitForSocket(socketPath, 15_000);

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
  for (const command of ifaceUpCommands(process.platform, parsed)) {
    /* Добавление маршрута, который уже есть, — не ошибка с точки зрения цели,
       поэтому жёстко требуем только назначение адреса и подьём интерфейса. */
    const critical = command.includes("address") || command.includes("inet") || command.includes("up");
    runTool(command, critical);
  }

  process.stdout.write("ok\n");
}

/** Снять туннель: убить клиента и убрать за ним правила маршрутизации. */
function down(confDir: string): void {
  for (const command of ifaceDownCommands(process.platform)) runTool(command, false);
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
