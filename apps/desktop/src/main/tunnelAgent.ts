/**
 * SERVICE-TUNNEL: служебный компонент туннеля (сторона SYSTEM).
 *
 * Это единственная часть проекта, которая постоянно работает с правами системы.
 * Запускает её задание планировщика, созданное установщиком один раз (см.
 * `build/installer.nsh`), поэтому при каждом включении VPN окно повышения прав
 * больше не нужно.
 *
 * Что делает:
 *   • раз в секунду отмечается в `agent.json` — по этой отметке приложение понимает,
 *     есть ли служебный компонент вообще;
 *   • забирает заявки `request.json` (поднять / снять) и выполняет их тем же
 *     работником `vpnHelper.js`, который раньше запускался через UAC (логика
 *     поднятия не дублируется — меняется только то, КТО его зовёт);
 *   • пока туннель поднят, каждые 5 секунд спрашивает у клиента время
 *     рукопожатия и пишет его в `tunnel.json`.
 *
 * Последнее — принципиально. UAPI-канал клиента создаётся процессом SYSTEM и
 * обычному пользователю недоступен. Если не отдавать сводку явно, окно будет
 * считать, что связи нет, и покажет ложную ошибку на рабочем туннеле.
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
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";

import {
  AGENT_FILE,
  REQUEST_FILE,
  STATUS_FILE,
  TUNNEL_FILE,
  parseRequest,
  serviceDir,
  type TunnelRequest,
} from "../shared/tunnelService";
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

/** Каталог обмена с приложением. Создаётся установщиком, но подстрахуемся. */
const DIR = serviceDir(process.platform, process.env);

/** Сколько ждём работника: поднятие включает ожидание рукопожатия. */
const JOB_TIMEOUT_MS = 120_000;

let busy = false;
let reportTimer: ReturnType<typeof setInterval> | null = null;

function writeJson(name: string, value: unknown): void {
  try {
    writeFileSync(join(DIR, name), JSON.stringify(value), { mode: 0o600 });
  } catch {
    /* каталог могли удалить вручную — восстановим на следующем такте */
  }
}

function readText(name: string): string | null {
  try {
    return readFileSync(join(DIR, name), "utf8");
  } catch {
    return null;
  }
}

function removeFile(name: string): void {
  try {
    rmSync(join(DIR, name), { force: true });
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
      const message = stderr.trim();
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
  removeFile(TUNNEL_FILE);
}

function startReports(): void {
  if (reportTimer) return;
  const tick = async () => {
    const handshake = await readHandshake();
    /* Клиент мог умереть сам — тогда сводка исчезает, и окно честно покажет
       потерю связи вместо зелёной кнопки. */
    if (handshake === null) {
      removeFile(TUNNEL_FILE);
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
  try {
    if (request.action === "down") {
      stopReports();
      const result = await runHelper(["down", DIR]);
      setStatus(request.id, result.ok ? "ok" : "error", result.error);
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

    /* Профиль кладётся рядом с заявкой, а не в профиль пользователя: служебный
       компонент работает вне сеанса и чужого профиля может не видеть. */
    const confPath = join(DIR, TUNNEL_CONF_FILE);
    writeFileSync(confPath, request.config.endsWith("\n") ? request.config : `${request.config}\n`, {
      mode: 0o600,
    });

    /* Перед поднятием снимаем прежний туннель: иначе адаптер занят, и новый
       клиент молча умирает на его создании. */
    stopReports();
    await runHelper(["down", DIR]);

    const result = await runHelper(["up", confPath, client]);
    if (result.ok) startReports();
    setStatus(request.id, result.ok ? "ok" : "error", result.error);
  } catch (err) {
    setStatus(
      request.id,
      "error",
      err instanceof Error ? err.message : "Неожиданная ошибка служебного компонента",
    );
  } finally {
    busy = false;
  }
}

function tick(): void {
  try {
    mkdirSync(DIR, { recursive: true, mode: 0o700 });
  } catch {
    /* уже есть — хорошо */
  }
  writeJson(AGENT_FILE, { pid: process.pid, at: Date.now() });

  if (busy) return;
  const raw = readText(REQUEST_FILE);
  if (raw === null) return;
  /* Заявка удаляется СРАЗУ: повторное выполнение одной и той же заявки при
     следующем такте пересобирало бы живой туннель посередине работы. */
  removeFile(REQUEST_FILE);
  const request = parseRequest(raw);
  if (!request) {
    writeJson(STATUS_FILE, {
      id: "rejected",
      state: "error",
      error: "Заявка не прошла проверку и отклонена",
      at: Date.now(),
    });
    return;
  }
  void handle(request);
}

function main(): void {
  tick();
  setInterval(tick, 1_000);
}

main();
