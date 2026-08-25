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
import { existsSync, readFileSync } from "node:fs";
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
async function elevatedScript(script: string): Promise<void> {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const inner = `-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
  const outer =
    `$p = Start-Process -FilePath 'powershell.exe' -ArgumentList ${psQuote(inner)} ` +
    `-Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`;
  try {
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", outer], {
      windowsHide: true,
      timeout: 120_000,
    });
  } catch (err) {
    const e = err as { code?: number; killed?: boolean; stderr?: string };
    if (e.killed) throw new Error("Команда управления туннелем не завершилась вовремя");
    /* Отказ в UAC — это выбор человека, а не поломка: текст говорит об этом прямо. */
    const stderr = (e.stderr || "").trim();
    if (/canceled|отменен|1223/i.test(stderr)) {
      throw new Error("Не выданы права администратора на включение туннеля");
    }
    throw new Error(stderr || "Не удалось выполнить команду управления туннелем");
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
async function adapterStatus(): Promise<string> {
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
    "$ErrorActionPreference = 'Stop'",
    `$dir = ${psQuote(targetDir)}`,
    "New-Item -ItemType Directory -Force -Path $dir | Out-Null",
    /* Права: только Система и Администраторы. В каталоге лежит приватный
       ключ туннеля, а %ProgramData% по умолчанию читаем всеми. */
    "icacls $dir /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' /grant:r 'Administrators:(OI)(CI)F' | Out-Null",
  ];

  for (const file of files) {
    lines.push(`Copy-Item -LiteralPath ${psQuote(file)} -Destination $dir -Force`);
  }

  lines.push(
    `$conf = ${psQuote(targetConf)}`,
    `[IO.File]::WriteAllBytes($conf, [Convert]::FromBase64String('${confB64}'))`,
    /* Снятие прежнего туннеля обоими именами службы и без падения, если их нет. */
    `$exe = ${psQuote(targetExe)}`,
    `& $exe /uninstalltunnelservice ${psQuote(TUNNEL_NAME)} 2>$null | Out-Null`,
    "Start-Sleep -Milliseconds 800",
    ...serviceNames().map(
      (name) => `sc.exe delete ${psQuote(name)} 2>$null | Out-Null`,
    ),
    /* Адаптер-призрак от предыдущей попытки мешает создать новый. */
    `Get-NetAdapter -Name ${psQuote(TUNNEL_NAME)} -ErrorAction SilentlyContinue | ` +
      "ForEach-Object { pnputil /remove-device $_.PnPDeviceID 2>$null | Out-Null }",
    "Start-Sleep -Milliseconds 500",
    `& $exe /installtunnelservice $conf`,
    "exit $LASTEXITCODE",
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
    if (await waitTunnelReady()) {
      return join(targetDir, basename(exe));
    }
    lastError = new Error(WIN_SERVICE_HINT);
  }

  throw lastError ?? new Error(WIN_SERVICE_HINT);
}

/**
 * Снятие туннеля. Служба снимается по ИМЕНИ, поэтому файл профиля для этого
 * не нужен — и хорошо, что не нужен: раньше выключение молча ничего не
 * делало, если файл уже был удалён, и туннель оставался поднятым.
 */
export async function windowsTunnelDown(exePath: string): Promise<void> {
  const targetDir = stableClientDir(process.env);
  const exe = exePath && existsSync(exePath) ? exePath : join(targetDir, "amneziawg.exe");
  const script = [
    "$ErrorActionPreference = 'Continue'",
    `$exe = ${psQuote(exe)}`,
    `if (Test-Path -LiteralPath $exe) { & $exe /uninstalltunnelservice ${psQuote(TUNNEL_NAME)} 2>$null | Out-Null }`,
    "Start-Sleep -Milliseconds 500",
    ...serviceNames().map((name) => `sc.exe delete ${psQuote(name)} 2>$null | Out-Null`),
    /* Профиль с приватным ключом не должен оставаться на диске после выключения. */
    `Remove-Item -LiteralPath ${psQuote(join(targetDir, TUNNEL_CONF_FILE))} -Force -ErrorAction SilentlyContinue`,
    "exit 0",
  ].join("\n");
  await elevatedScript(script);
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
