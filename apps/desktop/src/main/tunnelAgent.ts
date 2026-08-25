/**
 * SERVICE-TUNNEL: служебный компонент туннеля (сторона SYSTEM).
 *
 * Это единственная часть проекта, которая постоянно работает с правами системы.
 * Запускает её задание планировщика, созданное установщиком один раз (см.
 * `build/installer.nsh`), поэтому при каждом включении VPN окно повышения прав
 * больше не нужно.
 *
 * Модель доверия — главное в этом файле. Каталог заявок открыт на запись любому
 * пользователю машины — иначе приложение без прав администратора не смогло бы
 * попросить туннель вообще. Значит, заявка — ВСЕГДА недоверенные данные, и к
 * ней применяются три разных проверки, и каждая закрывает своё:
 *
 *   1. `parseRequest` — форма: ни путей к программам, ни аргументов, ни символов
 *      оболочки в профиле. Закрывает подстановку своей команды в `netsh`.
 *   2. разовое число (FIX-SVC-NONCE) — закрывает повтор сохранённой заявки.
 *   3. `checkConfigAgainstPolicy` (SERVICE-POLICY) — закрывает главное: чужой
 *      профиль. Синтаксически безупречный профиль может вести на сервер
 *      атакующего с его DNS — это перехват всего трафика машины без единого
 *      повышения прав. Потому проверяется не только ФОРМА, но и СОДЕРЖАНИЕ.
 *
 * Состояние (отметка, результат, сводка, профиль) лежит в ОТДЕЛЬНОМ каталоге,
 * закрытом на запись всем, кроме системы (FIX-SVC-ACL). До этого всё жило в одном
 * общем каталоге, и из этого следовало два неприятных свойства: состояние туннеля
 * можно было подделать, а профиль с приватным ключом мог прочитать другой
 * пользователь того же компьютера.
 *
 * Запуск: `<exe> <этот-файл>` при ELECTRON_RUN_AS_NODE=1 — без Chromium, без окон
 * и без стороннего Node в системе.
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";

import {
  AGENT_FILE,
  MAX_CONFIG_LENGTH,
  REQUEST_FILE,
  STATUS_FILE,
  TUNNEL_FILE,
  newNonce,
  parseRequest,
  serviceRequestDir,
  serviceStateDir,
  type TunnelRequest,
} from "../shared/tunnelService";
import {
  checkConfigAgainstPolicy,
  DEFAULT_POLICY,
  parsePolicy,
  POLICY_FILE,
  type TunnelPolicy,
} from "../shared/tunnelPolicy";
import {
  isObfuscatedConfig,
  TUNNEL_CONF_FILE,
  type VpnBackend,
} from "../shared/vpnPlan";
import {
  EMBEDDED_DIR,
  embeddedClientName,
  parseUapiHandshake,
  uapiSocketPath,
} from "../shared/vpnEmbedded";

/** Каталог состояния: только наша запись. */
const DIR = serviceStateDir(process.platform, process.env);
/** Каталог заявок: туда пишет приложение от имени пользователя. */
const REQ_DIR = serviceRequestDir(process.platform, process.env);

/** Сколько ждём работника: поднятие включает ожидание рукопожатия. */
const JOB_TIMEOUT_MS = 120_000;

/**
 * Предел размера файла заявки. Файл пишет недоверенная сторона, и читать
 * его целиком без оглядки на размер — готовый способ съесть память процесса
 * с правами SYSTEM одним гигабайтным файлом.
 */
const MAX_REQUEST_BYTES = MAX_CONFIG_LENGTH + 2_000;

let busy = false;
let reportTimer: ReturnType<typeof setInterval> | null = null;

/**
 * FIX-SVC-NONCE: значение, которое обязана предъявить следующая заявка.
 * Меняется после каждой рассмотренной заявки, включая отклонённые: иначе
 * подбор по одному и тому же значению был бы бесконечным.
 */
let nonce = newNonce();

/** Политика сервиса. Перекрытие берём только из каталога состояния. */
function policy(): TunnelPolicy {
  const raw = readText(DIR, POLICY_FILE);
  if (raw === null) return DEFAULT_POLICY;
  return parsePolicy(raw) ?? DEFAULT_POLICY;
}

function writeJson(name: string, value: unknown): void {
  try {
    writeFileSync(join(DIR, name), JSON.stringify(value), { mode: 0o600 });
  } catch {
    /* каталог могли удалить вручную — восстановим на следующем такте */
  }
}

function readText(dir: string, name: string): string | null {
  try {
    return readFileSync(join(dir, name), "utf8");
  } catch {
    return null;
  }
}

function removeFile(dir: string, name: string): void {
  try {
    rmSync(join(dir, name), { force: true });
  } catch {
    /* файла уже нет — цель достигнута */
  }
}

function setStatus(id: string, state: "running" | "ok" | "error", error = ""): void {
  writeJson(STATUS_FILE, { id, state, error, at: Date.now() });
}

/**
 * Каталог ресурсов установленного приложения.
 *
 * Нас запустили в режиме Node, поэтому `process.resourcesPath` может быть пуст:
 * считаем от своего же местоположения — `resources/app.asar/dist/main`.
 */
function resourcesDir(): string {
  const fromElectron = process.resourcesPath;
  if (fromElectron && existsSync(join(fromElectron, EMBEDDED_DIR))) return fromElectron;
  return join(__dirname, "..", "..", "..");
}

/** Путь к встроенному клиенту. Из заявки его брать НЕЛЬЗЯ: см. tunnelService.ts. */
function clientPath(backend: VpnBackend): string | null {
  const name = embeddedClientName(process.platform, backend);
  const candidates = [
    join(resourcesDir(), EMBEDDED_DIR, name),
    join(resourcesDir(), EMBEDDED_DIR, process.platform, name),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function helperScript(): string {
  return join(__dirname, "vpnHelper.js");
}

/**
 * Запуск работника. Он наследует наши права (SYSTEM), так что никакого
 * повышения и никаких окон здесь нет.
 */
function runHelper(args: string[]): Promise<{ ok: boolean; error: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean, error: string) => {
      if (settled) return;
      settled = true;
      resolve({ ok, error });
    };

    const child = spawn(process.execPath, [helperScript(), ...args], {
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* уже завершён */
      }
      done(false, "Команда управления туннелем не завершилась вовремя");
    }, JOB_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      done(false, err.message);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      /* FIX-SKIPNOISE: в сообщение для человека попадает только причина отказа.

         Работник пишет в тот же поток служебные строки вида
         «[trioz] шаг пропущен: netsh … delete route …» — это шум уборки: удаляем
         маршруты, которых могло и не быть. Прежде они целиком уезжали в окно
         вместе с ошибкой и выглядели как причина — а причина была совсем другой.
         В журнале процесса эти строки остаются: для разбора они полезны. */
      const message = stderr
        .split(/\r?\n/)
        .filter((line) => !line.trimStart().startsWith("[trioz] шаг пропущен:"))
        .join("\n")
        .trim();
      if (code === 0) return done(true, "");
      done(false, message || `работник завершился с кодом ${code}`);
    });
  });
}

/** Время последнего рукопожатия у клиента, или null, если он не ответил. */
function readHandshake(): Promise<number | null> {
  const socketPath = uapiSocketPath(process.platform);
  return new Promise((resolve) => {
    let out = "";
    const socket = connect(socketPath);
    socket.setTimeout(4_000);
    socket.on("connect", () => socket.end("get=1\n\n"));
    socket.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
    socket.on("error", () => resolve(null));
    socket.on("close", () => resolve(out ? parseUapiHandshake(out) : null));
  });
}

function stopReports(): void {
  if (reportTimer) {
    clearInterval(reportTimer);
    reportTimer = null;
  }
  removeFile(DIR, TUNNEL_FILE);
}

function startReports(): void {
  if (reportTimer) return;
  const tick = async () => {
    const handshake = await readHandshake();
    /* Клиент мог умереть сам — тогда сводка исчезает, и окно честно покажет
       потерю связи вместо зелёной кнопки. */
    if (handshake === null) {
      removeFile(DIR, TUNNEL_FILE);
      return;
    }
    writeJson(TUNNEL_FILE, { handshake, at: Date.now() });
  };
  void tick();
  reportTimer = setInterval(() => void tick(), 5_000);
}

async function handle(request: TunnelRequest): Promise<void> {
  busy = true;
  setStatus(request.id, "running");
  const confPath = join(DIR, TUNNEL_CONF_FILE);
  try {
    if (request.action === "down") {
      stopReports();
      const result = await runHelper(["down", DIR]);
      /* FIX-SVC-CONF: профиль не должен переживать туннель. */
      removeFile(DIR, TUNNEL_CONF_FILE);
      setStatus(request.id, result.ok ? "ok" : "error", result.error);
      return;
    }

    /* SERVICE-POLICY: самая важная проверка всего компонента: куда именно нас
       просят завернуть трафик и какой сервер имён назначить. */
    const verdict = checkConfigAgainstPolicy(request.config, policy());
    if (!verdict.ok) {
      setStatus(request.id, "error", `Профиль отклонён: ${verdict.reason}`);
      return;
    }

    const backend: VpnBackend = isObfuscatedConfig(request.config)
      ? "amneziawg"
      : "wireguard";
    const client = clientPath(backend);
    if (!client) {
      setStatus(
        request.id,
        "error",
        "Встроенный клиент отсутствует в этой сборке. Пересоберите приложение с шагом vendor:client.",
      );
      return;
    }

    /* Профиль ложится в каталог СОСТОЯНИЯ, а не рядом с заявкой: туда не
       пишет никто, кроме системы, и никто его не читает (FIX-SVC-ACL). */
    writeFileSync(confPath, request.config.endsWith("\n") ? request.config : `${request.config}\n`, {
      mode: 0o600,
    });

    /* Перед поднятием снимаем прежний туннель: иначе адаптер занят, и новый
       клиент молча умирает на его создании. */
    stopReports();
    await runHelper(["down", DIR]);

    const result = await runHelper(["up", confPath, client]);
    /* FIX-SVC-CONF: работник уже прочитал профиль и передал ключ клиенту через
       UAPI. Держать файл с приватным ключом на диске всё время работы туннеля
       незачем — и тем более незачем оставлять его после сбоя. */
    removeFile(DIR, TUNNEL_CONF_FILE);
    if (result.ok) startReports();
    setStatus(request.id, result.ok ? "ok" : "error", result.error);
  } catch (err) {
    removeFile(DIR, TUNNEL_CONF_FILE);
    setStatus(
      request.id,
      "error",
      err instanceof Error ? err.message : "Неожиданная ошибка служебного компонента",
    );
  } finally {
    busy = false;
  }
}

/** Текст заявки с оглядкой на размер: файл пишет недоверенная сторона. */
function readRequestText(): string | null {
  try {
    const path = join(REQ_DIR, REQUEST_FILE);
    const info = statSync(path);
    if (!info.isFile() || info.size > MAX_REQUEST_BYTES) return "";
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function tick(): void {
  try {
    mkdirSync(DIR, { recursive: true, mode: 0o700 });
    mkdirSync(REQ_DIR, { recursive: true, mode: 0o700 });
  } catch {
    /* уже есть — хорошо */
  }
  /* Отметка несёт разовое число для следующей заявки. */
  writeJson(AGENT_FILE, { pid: process.pid, at: Date.now(), nonce });

  if (busy) return;
  const raw = readRequestText();
  if (raw === null) return;
  /* Заявка удаляется СРАЗУ: повторное выполнение одной и той же заявки при
     следующем такте пересобирало бы живой туннель посередине работы. */
  removeFile(REQ_DIR, REQUEST_FILE);

  const request = parseRequest(raw);
  /* Любое рассмотрение сжигает разовое число — и удачное, и отказ. */
  const expected = nonce;
  nonce = newNonce();
  writeJson(AGENT_FILE, { pid: process.pid, at: Date.now(), nonce });

  if (!request) {
    writeJson(STATUS_FILE, {
      id: "rejected",
      state: "error",
      error: "Заявка не прошла проверку и отклонена",
      at: Date.now(),
    });
    return;
  }
  if (request.nonce !== expected) {
    /* Повтор сохранённой заявки или попытка угадать значение такта. */
    setStatus(request.id, "error", "Заявка устарела — повторите включение");
    return;
  }
  void handle(request);
}

function main(): void {
  tick();
  setInterval(tick, 1_000);
}

main();
