/**
 * FIX-WINCLIENT: автоматический сценарий поднятия туннеля на Windows.
 *
 * Раньше включение было одной строкой: запустить вендоренный клиент с
 * `/installtunnelservice` и считать, что туннель есть. На машине, где полный
 * клиент AmneziaWG был установлен раньше руками, это работало. На чистой — нет:
 * служба создавалась, но сразу умирала, и приложение говорило ровно то, что
 * видели пользователи: «туннель поднят, но связи с VPN-узлом нет».
 *
 * Здешний сценарий делает всё, что раньше делали руками:
 *
 *   1. кладёт клиента ЦЕЛИКОМ (exe и его библиотеки) в общий каталог машины
 *      `%ProgramData%\TrioZ\vpn`, куда у службы есть доступ и где нет ни пробелов,
 *      ни имени пользователя, ни версии приложения в пути;
 *   2. кладёт туда же профиль `trioz.conf` и ставит службу ИМЕННО оттуда;
 *   3. сначала снимает прежнюю службу и адаптер-призрак: повторная установка
 *      поверх живой службы — самая частая причина «1060» и мёртвых адаптеров;
 *   4. проверяет РЕЗУЛЬТАТ: служба RUNNING и адаптер Up. Если нет — пробует
 *      тот же сценарий клиентом, установленным в системе (если он есть), и только
 *      потом сдаётся с внятным текстом.
 *
 * Окно повышения прав одно на всё включение: копирование, снятие старой
 * службы и установка новой выполняются одним повышенным вызовом PowerShell.
 * Три отдельных запроса UAC на одно нажатие кнопки — тоже способ не включить VPN.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

import { TUNNEL_CONF_FILE, TUNNEL_NAME } from "../shared/vpnPlan";
import {
  serviceNames,
  stableClientDir,
  systemClientCandidates,
  WIN_CLIENT_OPTIONAL,
  WIN_SERVICE_HINT,
} from "../shared/vpnClient";

const run = promisify(execFile);

/** Сколько ждём, пока служба и адаптер появятся после установки. */
const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 700;
const SHUTDOWN_TIMEOUT_MS = 15_000;
const SHUTDOWN_FALLBACK_TIMEOUT_MS = 5_000;
const SHUTDOWN_POLL_MS = 350;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Кавычки для одинарной строки PowerShell: внутри кавычка удваивается. */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Один повышенный вызов PowerShell со сценарием внутри.
 *
 * Сценарий передаётся через base64 (`-EncodedCommand`), потому что через
 * `Start-Process -ArgumentList` любая кавычка или перенос строки в теле сценария
 * превращается в лишние аргументы — именно на этом раньше ломался вызов с
 * путём вида «TrioZ Connect».
 */
async function elevatedScript(script: string): Promise<number> {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  // Явно скрываем и повышенный PowerShell, а не только стартовое окно.
  // Запрос UAC остаётся системным и никогда не обходится.
  const inner = `-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
  const outer =
    `$p = Start-Process -FilePath 'powershell.exe' -ArgumentList ${psQuote(inner)} ` +
    `-Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`;
  try {
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", outer], {
      windowsHide: true,
      timeout: 120_000,
    });
    return 0;
  } catch (err) {
    const e = err as { code?: number; killed?: boolean; stderr?: string };
    if (e.killed) throw new Error("Команда управления туннелем не завершилась вовремя");
    /* Отказ в UAC — это выбор человека, а не поломка: текст говорит об этом прямо. */
    const stderr = (e.stderr || "").trim();
    if (/canceled|отмен|denied|1223/i.test(stderr)) {
      throw new Error("Не выданы права администратора на включение туннеля");
    }
    /* FIX-WINCODE: ненулевой код — ЕЩЁ НЕ отказ. Клиент туннеля пишет в stderr
       даже при успехе, а установка службы могла пройти. Раньше здесь летела
       ошибка «Не удалось выполнить команду управления туннелем», хотя реальную
       причину никто не видел. Теперь код возвращается наверх, а вердикт даёт
       проверка службы и адаптера плюс журнал сценария. */
    if (typeof e.code === "number") return e.code;
    throw new Error(stderr || "Не удалось выполнить команду управления туннелем");
  }
}

/** Путь к журналу повышенного сценария: единственный источник причины сбоя. */
function installLogPath(): string {
  return join(stableClientDir(process.env), "install.log");
}

/** Последние строки журнала — их показываем человеку вместо общей фразы. */
function installLogTail(): string {
  try {
    const text = readFileSync(installLogPath(), "utf8").trim();
    if (!text) return "";
    const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
    return lines.slice(-4).join("; ").slice(0, 400);
  } catch {
    return "";
  }
}

/** Жива ли служба туннеля (любое из двух имён). */
export async function tunnelServiceRunning(): Promise<boolean> {
  for (const name of serviceNames()) {
    try {
      const { stdout } = await run("sc.exe", ["query", name], { windowsHide: true, timeout: 10_000 });
      if (/RUNNING/i.test(stdout)) return true;
    } catch {
      /* службы с таким именем нет — пробуем второе */
    }
  }
  return false;
}

/** Состояние адаптера туннеля: `Up`, другое слово или пусто (адаптера нет). */
export async function adapterStatus(): Promise<string> {
  try {
    const { stdout } = await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-NetAdapter -Name ${psQuote(TUNNEL_NAME)} -ErrorAction SilentlyContinue).Status`,
      ],
      { windowsHide: true, timeout: 15_000 },
    );
    return stdout.trim();
  } catch {
    return "";
  }
}

export type TunnelServiceState = "RUNNING" | "STOP_PENDING" | "STOPPED" | "OTHER" | "MISSING";
export interface TunnelServiceSnapshot {
  name: string;
  state: TunnelServiceState;
  pid: number | null;
}

/** Точное состояние только двух служб TrioZ; сторонние туннели не запрашиваются. */
export async function tunnelServiceSnapshots(): Promise<TunnelServiceSnapshot[]> {
  const snapshots: TunnelServiceSnapshot[] = [];
  for (const name of serviceNames()) {
    try {
      const { stdout } = await run("sc.exe", ["queryex", name], { windowsHide: true, timeout: 10_000 });
      const stateMatch = stdout.match(/STATE\s*:\s*\d+\s+([A-Z_]+)/i);
      const rawState = stateMatch?.[1]?.toUpperCase() ?? "OTHER";
      const state: TunnelServiceState =
        rawState === "RUNNING" || rawState === "STOP_PENDING" || rawState === "STOPPED"
          ? rawState
          : "OTHER";
      const pidMatch = stdout.match(/PID\s*:\s*(\d+)/i);
      const pid = pidMatch && Number(pidMatch[1]) > 0 ? Number(pidMatch[1]) : null;
      snapshots.push({ name, state, pid });
    } catch {
      snapshots.push({ name, state: "MISSING", pid: null });
    }
  }
  return snapshots;
}

async function processExists(pid: number): Promise<boolean> {
  try {
    const { stdout } = await run(
      "tasklist.exe",
      ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
      { windowsHide: true, timeout: 10_000 },
    );
    return new RegExp(`\"${pid}\"`).test(stdout) && !/No tasks are running/i.test(stdout);
  } catch {
    return false;
  }
}

/**
 * PID orphan-процесса после исчезновения service record. Фильтр не по имени
 * amneziawg.exe, а по точному пути профиля TrioZ в command line.
 */
export async function tunnelProcessPids(): Promise<number[]> {
  const conf = join(stableClientDir(process.env), TUNNEL_CONF_FILE);
  try {
    const { stdout } = await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$needle = ${psQuote(conf)}; Get-CimInstance Win32_Process | ` +
          `Where-Object { $_.CommandLine -like "*$needle*" } | ` +
          "Select-Object -ExpandProperty ProcessId",
      ],
      { windowsHide: true, timeout: 15_000 },
    );
    return stdout
      .split(/\r?\n/)
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
}

/** Реальный TrioZ tunnel, независимо от состояния Electron. */
export async function windowsTunnelExists(): Promise<boolean> {
  const services = await tunnelServiceSnapshots();
  if (services.some((service) => service.state !== "MISSING")) return true;
  if ((await tunnelProcessPids()).length > 0) return true;
  return (await adapterStatus()) !== "";
}

export interface TunnelShutdownRuntime {
  now(): number;
  sleep(ms: number): Promise<void>;
  services(): Promise<TunnelServiceSnapshot[]>;
  discoverPids(): Promise<number[]>;
  processExists(pid: number): Promise<boolean>;
  adapterStatus(): Promise<string>;
  uninstall(exe: string): Promise<void>;
  fallback(exe: string, pids: number[]): Promise<void>;
  removeConfig(): void;
}

async function waitUntil(
  runtime: TunnelShutdownRuntime,
  deadline: number,
  predicate: () => Promise<boolean>,
): Promise<boolean> {
  while (runtime.now() < deadline) {
    if (await predicate()) return true;
    await runtime.sleep(SHUTDOWN_POLL_MS);
  }
  return predicate();
}

function uninstallScript(exe: string): string {
  return [
    "$ErrorActionPreference = 'Continue'",
    `$exe = ${psQuote(exe)}`,
    `if (Test-Path -LiteralPath $exe) { & $exe /uninstalltunnelservice ${psQuote(TUNNEL_NAME)} 2>$null | Out-Null }`,
    "exit 0",
  ].join("\n");
}

/**
 * Fallback запускается только после штатного uninstall и ожидания. PID берутся
 * из `sc queryex` конкретных служб TrioZ; перед Stop-Process PowerShell ещё раз
 * проверяет, что command line/executable относится к trioz.conf или нашему exe.
 */
function cleanupFallbackScript(exe: string, pids: number[]): string {
  const lines = [
    "$ErrorActionPreference = 'Continue'",
    ...serviceNames().map((name) =>
      `$s = Get-Service -Name ${psQuote(name)} -ErrorAction SilentlyContinue; ` +
      `if ($s -and $s.Status -ne 'Stopped') { Stop-Service -Name ${psQuote(name)} -ErrorAction SilentlyContinue; ` +
      `foreach ($i in 1..20) { Start-Sleep -Milliseconds 250; $s.Refresh(); if ($s.Status -eq 'Stopped') { break } } }; ` +
      `if ($s -and $s.Status -eq 'Stopped') { sc.exe delete ${psQuote(name)} 2>$null | Out-Null }`,
    ),
  ];
  for (const pid of pids) {
    lines.push(
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue; ` +
      `if ($p -and (($p.CommandLine -like '*trioz.conf*') -or ($p.ExecutablePath -eq ${psQuote(exe)}))) ` +
      `{ Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue }`,
    );
  }
  lines.push(
    `$a = Get-NetAdapter -Name ${psQuote(TUNNEL_NAME)} -ErrorAction SilentlyContinue; ` +
      "if ($a) { pnputil /remove-device $a.PnPDeviceID 2>$null | Out-Null }",
    "exit 0",
  );
  return lines.join("\n");
}

function defaultShutdownRuntime(): TunnelShutdownRuntime {
  const targetDir = stableClientDir(process.env);
  return {
    now: () => Date.now(),
    sleep,
    services: tunnelServiceSnapshots,
    discoverPids: tunnelProcessPids,
    processExists,
    adapterStatus,
    uninstall: async (exe) => { await elevatedScript(uninstallScript(exe)); },
    fallback: async (exe, pids) => { await elevatedScript(cleanupFallbackScript(exe, pids)); },
    removeConfig: () => {
      try {
        unlinkSync(join(targetDir, TUNNEL_CONF_FILE));
      } catch {
        /* профиль уже удалён */
      }
    },
  };
}

/**
 * FIX-WINLINK: есть ли НА САМОМ ДЕЛЕ связь с узлом.
 *
 * Прежняя проверка считала живую службу достаточным доказательством связи. Адаптер
 * бывает Up и тогда, когда узел молчит: именно так рождалось зелёное
 * «Соединение активно» при отсутствии интернета. Канал управления туннелем
 * принадлежит службе и обычному пользователю закрыт, поэтому смотрим на то,
 * что видно без прав: сколько байт пришло НА адаптер. Входящие байты в
 * туннеле берутся только от узла: если их нет — рукопожатия уходят в пустоту.
 */
export async function windowsLinkVerdict(): Promise<"fresh" | "silent" | "unknown"> {
  try {
    const { stdout } = await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-NetAdapterStatistics -Name ${psQuote(TUNNEL_NAME)} -ErrorAction SilentlyContinue).ReceivedBytes`,
      ],
      { windowsHide: true, timeout: 15_000 },
    );
    const raw = stdout.trim();
    if (raw === "") return "unknown";
    const received = Number(raw);
    if (!Number.isFinite(received)) return "unknown";
    /* Несколько сотен байт — это уже ответ узла, а не шум: собственные
       исходящие пакеты в этот счётчик не попадают. */
    return received > 0 ? "fresh" : "silent";
  } catch {
    return "unknown";
  }
}

/**
 * Служба и адаптер появились в отведённое время. Важно ждать ОБА признака:
 * служба без адаптера — и есть тот самый случай с ненайденным путём.
 */
async function waitTunnelReady(): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await tunnelServiceRunning()) {
      const status = await adapterStatus();
      if (/Up/i.test(status)) return true;
    }
    await sleep(READY_POLL_MS);
  }
  return false;
}

/** Файлы клиента, которые надо перенести в общий каталог. */
function clientFiles(exePath: string): string[] {
  const dir = dirname(exePath);
  const files = [exePath];
  for (const name of WIN_CLIENT_OPTIONAL) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) files.push(candidate);
  }
  return files;
}

/**
 * Сценарий для повышенного PowerShell: подготовить каталог, скопировать клиента
 * и профиль, снять прежнюю службу и поставить новую.
 *
 * Профиль передаётся внутри сценария base64, а не копируется из каталога
 * пользователя: каталог профиля закрыт ACL и службе может быть недоступен,
 * а ключ в общем каталоге сразу закрывается правами только для системы и
 * администраторов.
 */
function installScript(exePath: string, config: string, targetDir: string): string {
  const files = clientFiles(exePath);
  const targetExe = join(targetDir, basename(exePath));
  const targetConf = join(targetDir, TUNNEL_CONF_FILE);
  const confB64 = Buffer.from(config.endsWith("\n") ? config : `${config}\n`, "utf8").toString("base64");

  const lines: string[] = [
    /* FIX-WINSTOP: 'Stop' здесь был вреден. В PowerShell любая строка, которую
       внешняя программа пишет в поток ошибок, при 'Stop' превращается в
       исключение, а клиент туннеля пишет туда и при успешной установке. Из-за
       этого сценарий обрывался на первой же служебной строке, наружу уходил
       только код возврата, и приложение показывало общую фразу «Не удалось
       выполнить команду управления туннелем». Ошибки разбираем по факту. */
    "$ErrorActionPreference = 'Continue'",
    "$ProgressPreference = 'SilentlyContinue'",
    `$dir = ${psQuote(targetDir)}`,
    "New-Item -ItemType Directory -Force -Path $dir | Out-Null",
    `$log = ${psQuote(join(targetDir, "install.log"))}`,
    "Set-Content -LiteralPath $log -Value \"start $(Get-Date -Format o)\" -Encoding UTF8",
    "function L($m) { Add-Content -LiteralPath $log -Value $m -Encoding UTF8 }",
    /* Права: только Система и Администраторы. В каталоге лежит приватный
       ключ туннеля, а %ProgramData% по умолчанию читаем всеми.
       FIX-WINACL: имена групп задаём через SID. На русской Windows группы
       «Administrators» нет — она называется «Администраторы», icacls такой
       строки не находил, а /inheritance:r к тому моменту уже снял наследование.
       Каталог оставался без прав, служба не могла прочитать профиль и умирала
       с «Системе не удается найти указанный путь». */
    "icacls $dir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' /grant:r '*S-1-5-32-544:(OI)(CI)F' *>> $log",
    `$exe = ${psQuote(targetExe)}`,
    `$conf = ${psQuote(targetConf)}`,
    /* FIX-WINORDER: сначала СНЯТЬ прежний туннель, потом копировать файлы.
       В обратном порядке (как было) живая служба держит exe и библиотеки
       открытыми, Copy-Item падает с отказом доступа, и повторное включение
       не работало вообще никогда — только первое, на чистой машине. */
    "L 'stage: stop old tunnel'",
    `if (Test-Path -LiteralPath $exe) { & $exe /uninstalltunnelservice ${psQuote(TUNNEL_NAME)} *>> $log }`,
    /* Повторная установка тоже не должна делать blind sc delete: ждём
       остановки каждой конкретной TrioZ-службы, delete — только fallback для
       уже STOPPED записи. Успешная install-ветка ниже не меняется. */
    ...serviceNames().map(
      (name) =>
        `$s = Get-Service -Name ${psQuote(name)} -ErrorAction SilentlyContinue; ` +
        `if ($s -and $s.Status -ne 'Stopped') { Stop-Service -Name ${psQuote(name)} -ErrorAction SilentlyContinue; ` +
        `foreach ($i in 1..40) { Start-Sleep -Milliseconds 250; $s.Refresh(); if ($s.Status -eq 'Stopped') { break } } }; ` +
        `if ($s -and $s.Status -eq 'Stopped') { sc.exe delete ${psQuote(name)} *>> $log }`,
    ),
    /* Адаптер-призрак от предыдущей попытки мешает создать новый. */
    `Get-NetAdapter -Name ${psQuote(TUNNEL_NAME)} -ErrorAction SilentlyContinue | ` +
      "ForEach-Object { pnputil /remove-device $_.PnPDeviceID *>> $log }",
    "Start-Sleep -Milliseconds 800",
    "L 'stage: copy client'",
  ];

  for (const file of files) {
    lines.push(
      `try { Copy-Item -LiteralPath ${psQuote(file)} -Destination $dir -Force -ErrorAction Stop } ` +
        `catch { L "copy failed: ${basename(file)} $($_.Exception.Message)" }`,
    );
  }

  lines.push(
    "L 'stage: write profile'",
    `[IO.File]::WriteAllBytes($conf, [Convert]::FromBase64String('${confB64}'))`,
    /* Профиль без клиента ставить некуда: это единственная действительно
       безнадёжная ситуация, и её видно в журнале сразу. */
    "if (-not (Test-Path -LiteralPath $exe)) { L 'client missing in target dir'; exit 4 }",
    "L 'stage: install service'",
    `& $exe /installtunnelservice $conf *>> $log`,
    "$code = $LASTEXITCODE",
    "L \"installtunnelservice exit: $code\"",
    /* Ждём службу здесь же, под правами администратора: без прав состояние
       службы иногда не читается, и снаружи это выглядело как «не поднялось». */
    "$ok = $false",
    "foreach ($i in 1..25) {",
    `  foreach ($n in @(${serviceNames().map(psQuote).join(", ")})) {`,
    "    $s = Get-Service -Name $n -ErrorAction SilentlyContinue",
    "    if ($s -and $s.Status -eq 'Running') { $ok = $true }",
    "  }",
    "  if ($ok) { break }",
    "  Start-Sleep -Milliseconds 600",
    "}",
    "L \"service running: $ok\"",
    `L "adapter: $((Get-NetAdapter -Name ${psQuote(TUNNEL_NAME)} -ErrorAction SilentlyContinue).Status)"`,
    "if ($ok) { exit 0 } else { exit 3 }",
  );

  return lines.join("\n");
}

/** Установленный в системе клиент, если он есть. */
function systemClient(): string | null {
  for (const candidate of systemClientCandidates(process.env)) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Поднять туннель на Windows. Возвращает путь к клиенту, которым туннель
 * фактически поднят: снимать его нужно тем же самым.
 *
 * @param config текст профиля (в каталог пользователя он тоже записан, но службе
 *               отдаём копию в общем каталоге)
 * @param embeddedExe путь к вендоренному клиенту из ресурсов сборки (или null)
 */
export async function windowsTunnelUp(config: string, embeddedExe: string | null): Promise<string> {
  const targetDir = stableClientDir(process.env);
  const system = systemClient();

  /* Порядок попыток: сначала свой клиент (ничего ставить не надо), потом —
     установленный в системе: именно такая вторая попытка раньше делалась руками
     и была единственным работающим сценарием. */
  const attempts = [embeddedExe, system].filter((exe): exe is string => !!exe && existsSync(exe));
  if (attempts.length === 0) {
    throw new Error(
      "Встроенный клиент отсутствует в этой сборке. Пересоберите приложение с шагом vendor:client.",
    );
  }

  let lastError: Error | null = null;
  for (const exe of attempts) {
    try {
      await elevatedScript(installScript(exe, config, targetDir));
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      /* Отказ в правах — вторая попытка бессмысленна: спросить ещё раз значит
         второе окно UAC на одно нажатие. */
      if (/права администратора/i.test(lastError.message)) throw lastError;
      continue;
    }
    /* Вердикт даёт состояние системы, а не код возврата клиента. */
    if (await waitTunnelReady()) {
      return join(targetDir, basename(exe));
    }
    const tail = installLogTail();
    lastError = new Error(tail ? `${WIN_SERVICE_HINT} Журнал: ${tail}` : WIN_SERVICE_HINT);
  }

  throw lastError ?? new Error(WIN_SERVICE_HINT);
}

/**
 * Снятие туннеля. Служба снимается по ИМЕНИ, поэтому файл профиля для этого
 * не нужен — и хорошо, что не нужен: раньше выключение молча ничего не
 * делало, если файл уже был удалён, и туннель оставался поднятым.
 */
export async function windowsTunnelDown(
  exePath: string,
  runtime: TunnelShutdownRuntime = defaultShutdownRuntime(),
): Promise<void> {
  const targetDir = stableClientDir(process.env);
  const exe = exePath && existsSync(exePath) ? exePath : join(targetDir, "amneziawg.exe");
  const pids = new Set<number>();
  const services = async () => {
    const snapshots = await runtime.services();
    for (const service of snapshots) if (service.pid) pids.add(service.pid);
    return snapshots;
  };

  await services();
  for (const pid of await runtime.discoverPids()) pids.add(pid);
  await runtime.uninstall(exe);
  const deadline = runtime.now() + SHUTDOWN_TIMEOUT_MS;

  const stopped = await waitUntil(runtime, deadline, async () =>
    (await services()).every((service) => service.state === "STOPPED" || service.state === "MISSING"),
  );
  const absent = stopped && await waitUntil(runtime, deadline, async () =>
    (await services()).every((service) => service.state === "MISSING"),
  );
  const processesGone = absent && await waitUntil(runtime, deadline, async () => {
    for (const pid of pids) if (await runtime.processExists(pid)) return false;
    return true;
  });
  const adapterGone = processesGone && await waitUntil(
    runtime,
    deadline,
    async () => (await runtime.adapterStatus()) === "",
  );

  if (!stopped || !absent || !processesGone || !adapterGone) {
    /* sc delete здесь не заменяет ожидание: это строго fallback после штатного
       uninstall и polling. Он касается только двух служб, захваченных PID и
       адаптера с точным именем `trioz`. */
    await runtime.fallback(exe, [...pids]);
    const fallbackDeadline = runtime.now() + SHUTDOWN_FALLBACK_TIMEOUT_MS;
    const clean = await waitUntil(runtime, fallbackDeadline, async () => {
      const currentServices = await services();
      if (currentServices.some((service) => service.state !== "MISSING")) return false;
      for (const pid of pids) if (await runtime.processExists(pid)) return false;
      return (await runtime.adapterStatus()) === "";
    });
    if (!clean) {
      throw new Error("Туннель TrioZ не завершился полностью за отведённое время");
    }
  }

  /* Профиль с приватным ключом удаляем только после подтверждённого cleanup. */
  runtime.removeConfig();
}

/**
 * Профиль, которым сейчас живёт служба — нужен только для диагностики
 * в журнале: чтобы поддержка могла отличить «нет профиля» от «профиль есть,
 * но узел молчит», не спрашивая человека команды в PowerShell.
 */
export function stableConfExists(): boolean {
  try {
    const path = join(stableClientDir(process.env), TUNNEL_CONF_FILE);
    return existsSync(path) && readFileSync(path, "utf8").includes("[Interface]");
  } catch {
    return false;
  }
}
