/**
 * Иконки десктоп-приложения собираются из одного исходника — docs/logostol.png.
 *
 * Раньше в репозитории лежали три готовые картинки (build/icon.png,
 * build/icon.ico, resources/icon.png) плюс отдельная иконка трея. При смене
 * логотипа их приходилось перерисовывать по одной, и любая забытая копия
 * означала старый логотип в каком-нибудь одном месте — в трее или в
 * установщике.
 *
 * Теперь копия одна и живёт в docs/. Этот скрипт раскладывает её по местам
 * перед сборкой (см. npm run build), а .ico для Windows electron-builder
 * делает сам из png — отдельно хранить его незачем.
 *
 * Размеры не меняем намеренно: исходник 1024×1024, ровно то, что нужно
 * electron-builder для генерации всех форматов. Прозрачность сохраняется —
 * файл просто копируется байт в байт.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const repoRoot = resolve(desktopRoot, "..", "..");

const SOURCE = join(repoRoot, "docs", "logostol.png");

/** Куда раскладываем: сборка установщика и иконки времени выполнения. */
const TARGETS = [
  join(desktopRoot, "build", "icon.png"),      // electron-builder: окно, .ico, .icns
  join(desktopRoot, "resources", "icon.png"),  // иконка окна приложения
  join(desktopRoot, "resources", "tray.png"),  // трей (уменьшается на лету)
];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fail(message) {
  console.error(`[icons] ${message}`);
  process.exit(1);
}

if (!existsSync(SOURCE)) {
  fail(`не найден исходник иконки ${SOURCE}. Положите логотип в docs/logostol.png.`);
}

/* Проверяем заголовок PNG: 8 байт подписи, дальше блок IHDR — ширина, высота и
   тип цвета. Ошибиться файлом легко, а узнать об этом на этапе установки уже
   поздно. */
const head = readFileSync(SOURCE).subarray(0, 26);
if (!head.subarray(0, 8).equals(PNG_SIGNATURE)) fail("docs/logostol.png не является PNG.");

const width = head.readUInt32BE(16);
const height = head.readUInt32BE(20);
const colorType = head.readUInt8(25);

if (width !== height) {
  fail(`иконка должна быть квадратной, а сейчас ${width}×${height}.`);
}
if (width < 512) {
  fail(`иконка мельче 512 пикселей (${width}×${height}) — установщик и Retina требуют крупнее.`);
}
/* Типы цвета с альфой: 4 (серый + альфа) и 6 (RGBA). Без прозрачности логотип
   поедет с непрозрачным прямоугольником вокруг — на тёмной панели задач это
   заметно сразу. */
if (colorType !== 4 && colorType !== 6) {
  console.warn("[icons] предупреждение: в PNG нет альфа-канала — иконка будет с непрозрачным фоном.");
}

for (const target of TARGETS) {
  mkdirSync(dirname(target), { recursive: true });
  /* Не переписываем одинаковое: пересборка не должна дёргать mtime и заставлять
     electron-builder заново готовить ресурсы. */
  if (existsSync(target) && statSync(target).size === statSync(SOURCE).size) {
    if (readFileSync(target).equals(readFileSync(SOURCE))) continue;
  }
  copyFileSync(SOURCE, target);
}

console.log(`[icons] иконки разложены из docs/logostol.png (${width}×${height})`);
