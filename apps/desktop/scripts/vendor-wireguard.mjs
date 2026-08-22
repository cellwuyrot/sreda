#!/usr/bin/env node
/**
 * VPN-EMBEDDED: укладка встроенного клиента туннеля в ресурсы сборки.
 *
 * Зачем шаг сборки, а не бинарники в git: двоичные файлы на три платформы — это
 * десятки мегабайт в истории репозитория навсегда, и обновить их потом нельзя
 * без такого же роста. Поэтому клиент берётся из каталога, на который указывает
 * `TRIOZ_CLIENT_SRC`, и кладётся в `resources/wireguard/<платформа>/`, откуда
 * electron-builder переносит его в `resourcesPath/wireguard` — рядом с приложением и
 * ВНЕ asar (из asar нельзя ни запустить файл, ни выставить ему права).
 *
 * Почему скрипт не качает из сети сам: вся суть правки — чтобы конечный
 * пользователь ничего не скачивал. Скачивание на машине сборки возможно, но
 * бинарник туннеля, приехавший по непроверенной ссылке в релиз, — худшее из
 * возможных решений. Пусть источник задаёт тот, кто собирает.
 *
 * Использование:
 *   TRIOZ_CLIENT_SRC=/path/to/binaries npm run vendor:client
 *   npm run vendor:client -- --allow-missing   # пропустить (для dev-сборок без туннеля)
 *
 * Ожидаемые имена в каталоге-источнике (совпадают с embeddedClientName()):
 *   win32  — wireguard.exe
 *   darwin — wireguard-go
 *   linux  — wireguard-go
 *
 * Утилита `wg` в списке больше не нужна: туннель настраивается через UAPI нашим
 * же кодом. На Windows теперь берётся официальный `wireguard.exe` из проекта
 * wireguard-windows: он сам ставит службу WireGuardTunnel$<name> и применяет
 * корректную full-tunnel маршрутизацию через WireGuardNT.
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");

/**
 * Что нужно каждой платформе: сам клиент и — только в Windows — драйвер
 * сетевого устройства, без которого клиент не создаст интерфейс.
 */
const LAYOUT = {
  win32: ["wireguard.exe"],
  darwin: ["wireguard-go"],
  linux: ["wireguard-go"],
};

/**
 * FIX-BACKEND: клиент устойчивого к блокировкам режима (AmneziaWG).
 *
 * Он нужен ТОЛЬКО для узлов с маскировкой, поэтому его отсутствие не должно
 * ронять сборку. Но и молчать нельзя: раньше этот файл не копировался вообще,
 * и профиль с параметрами маскировки поднимался обычным клиентом. Узел такое
 * рукопожатие молча отбрасывает — со стороны это выглядело как «туннель поднят,
 * а узел не ответил», хотя сервер был жив и профиль верен.
 */
const OPTIONAL_LAYOUT = {
  win32: ["amneziawg-go.exe"],
  darwin: ["amneziawg-go"],
  linux: ["amneziawg-go"],
};

const args = process.argv.slice(2);
const allowMissing = args.includes("--allow-missing");
const onlyPlatform = (() => {
  const i = args.indexOf("--platform");
  return i >= 0 ? args[i + 1] : process.env.TRIOZ_CLIENT_PLATFORM || process.platform;
})();

const src = process.env.TRIOZ_CLIENT_SRC ? resolve(process.env.TRIOZ_CLIENT_SRC) : "";

function log(msg) {
  process.stdout.write(`[vendor:client] ${msg}\n`);
}

/**
 * Исходник может быть как плоским (все файлы рядом), так и разложенным по
 * подкаталогам платформ — второе удобнее, когда собирают сразу под всё.
 */
function findSource(platform, file) {
  const candidates = [join(src, platform, file), join(src, file)];
  return candidates.find((p) => existsSync(p) && statSync(p).isFile()) || "";
}

function vendor(platform) {
  const files = LAYOUT[platform];
  if (!files) {
    throw new Error(`Неизвестная платформа: ${platform}`);
  }
  const outDir = join(appDir, "resources", "wireguard", platform);

  const found = files.map((file) => [file, findSource(platform, file)]);
  const missing = found.filter(([, from]) => !from).map(([file]) => file);

  if (missing.length) {
    const hint = src
      ? `Не найдено в ${src}: ${missing.join(", ")}`
      : "Не задан TRIOZ_CLIENT_SRC — неоткуда взять клиента";
    if (allowMissing) {
      /* Сборка продолжится, но туннель в ней не включится, и скажет об этом явно
         (см. текст ошибки в main/vpn.ts). Лучше, чем тихая сборка-пустышка. */
      log(`ПРОПУСК ${platform}: ${hint}`);
      return false;
    }
    throw new Error(
      `${hint}\n` +
        `Ожидаются файлы: ${files.join(", ")}\n` +
        `Запустите: TRIOZ_CLIENT_SRC=/путь/к/бинарникам npm run vendor:client\n` +
        `Либо npm run vendor:client -- --allow-missing для сборки без туннеля.`,
    );
  }

  /* Чистим каталог полностью: старый бинарник, оставшийся от предыдущего запуска,
     уедет в релиз незамеченным. */
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  for (const [file, from] of found) {
    const to = join(outDir, file);
    copyFileSync(from, to);
    /* Право на запуск теряется при копировании через архивы и CI-артефакты. */
    if (platform !== "win32") chmodSync(to, 0o755);
    log(`${platform}/${file} ← ${from}`);
  }

  /* FIX-BACKEND: необязательные бинарники — по возможности и вслух. */
  for (const file of OPTIONAL_LAYOUT[platform] || []) {
    const from = findSource(platform, file);
    if (!from) {
      log(`нет ${platform}/${file}: узлы с маскировкой в этой сборке работать не будут`);
      continue;
    }
    const to = join(outDir, file);
    copyFileSync(from, to);
    if (platform !== "win32") chmodSync(to, 0o755);
    log(`${platform}/${file} ← ${from}`);
  }
  return true;
}

try {
  const platforms = onlyPlatform === "all" ? Object.keys(LAYOUT) : [onlyPlatform];
  let ok = false;
  for (const platform of platforms) ok = vendor(platform) || ok;
  if (ok) {
    const dir = join(appDir, "resources", "wireguard");
    log(`Готово: ${readdirSync(dir).join(", ")}`);
  }
} catch (e) {
  process.stderr.write(`[vendor:client] ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
