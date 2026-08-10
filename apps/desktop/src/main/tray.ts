import { Tray, Menu, nativeImage, app } from "electron";
import path from "path";
import { focusMainWindow, getMainWindow, setQuitting } from "./mainWindow";
import { clearCacheAndReload } from "./recovery"; // FIX-BLANK
import { setBadgeListener } from "./badge";
import { checkForUpdatesNow } from "./updater";
import { IPC } from "../shared/constants";

let tray: Tray | null = null;

/** Высота значка в трее: 16 логических точек, ×2 под экраны с удвоением. */
const TRAY_SIZE = 32;

/**
 * Значок в трее делается из той же иконки, что и всё остальное
 * (resources/tray.png — копия docs/logostol.png, см. scripts/prepare-icons.mjs).
 *
 * Раньше рядом лежал отдельный файл trayTemplate.png для macOS — вторая копия
 * логотипа, которую при смене иконки забывали перерисовать. Теперь чёрный
 * силуэт для строки меню считается на лету: у изображения обнуляются цветовые
 * каналы, а прозрачность остаётся — именно этого macOS ждёт от template-иконки
 * (сама подкрашивает её под светлую или тёмную тему).
 */
function trayImage(): Electron.NativeImage {
  const source = nativeImage.createFromPath(path.join(__dirname, "../../resources/tray.png"));
  // Исходник крупный (1024): уменьшаем сами, иначе система масштабирует грубо.
  const image = source.isEmpty() ? source : source.resize({ width: TRAY_SIZE, height: TRAY_SIZE, quality: "best" });
  if (process.platform !== "darwin" || image.isEmpty()) return image;

  const { width, height } = image.getSize();
  const bitmap = image.toBitmap(); // BGRA, по 4 байта на точку
  for (let i = 0; i < bitmap.length; i += 4) {
    bitmap[i] = 0;     // B
    bitmap[i + 1] = 0; // G
    bitmap[i + 2] = 0; // R
    // bitmap[i + 3] — прозрачность, её не трогаем: это и есть форма значка
  }
  const template = nativeImage.createFromBitmap(bitmap, { width, height });
  template.setTemplateImage(true);
  return template;
}

function sendToRenderer(channel: string, ...args: unknown[]): void {
  getMainWindow()?.webContents.send(channel, ...args);
}

function buildMenu(): Electron.Menu {
  return Menu.buildFromTemplate([
    { label: "Открыть TrioZ Connect", click: () => focusMainWindow() },
    // FIX-BLANK: аварийный выход из «тёмного экрана» без переустановки —
    // сброс HTTP-кеша и перезагрузка страницы (сессия сохраняется).
    {
      label: "Перезагрузить без кеша",
      click: () => {
        const win = getMainWindow();
        if (!win) return;
        focusMainWindow();
        // force: человек попросил сам — откладывать нечего, даже если идёт разговор.
        void clearCacheAndReload(win, "ручная перезагрузка из трея", { force: true });
      },
    },
    { type: "separator" },
    {
      label: "Заглушить / включить микрофон",
      click: () => sendToRenderer(IPC.TOGGLE_MUTE),
    },
    { type: "separator" },
    // Only meaningful in packaged builds, where electron-updater has a feed to
    // query; in dev it just explains there is nothing to update.
    ...(app.isPackaged
      ? [
          {
            label: "Проверить обновления",
            click: () => checkForUpdatesNow(true),
          },
          { type: "separator" as const },
        ]
      : []),
    {
      label: "Выход",
      click: () => {
        setQuitting(true);
        app.quit();
      },
    },
  ]);
}

export function createTray(): void {
  if (tray) return;
  tray = new Tray(trayImage());
  tray.setToolTip("TrioZ Connect");
  tray.setContextMenu(buildMenu());

  // Left-click toggles the window on Windows/Linux (standard behavior).
  tray.on("click", () => focusMainWindow());

  // Reflect the unread count in the tray tooltip.
  setBadgeListener((total) => {
    if (!tray || tray.isDestroyed()) return;
    tray.setToolTip(total > 0 ? `TrioZ Connect — ${total} непрочитанных` : "TrioZ Connect");
  });
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
