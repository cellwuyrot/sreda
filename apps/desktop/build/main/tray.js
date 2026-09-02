"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTray = createTray;
exports.destroyTray = destroyTray;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const mainWindow_1 = require("./mainWindow");
const recovery_1 = require("./recovery"); // FIX-BLANK
const badge_1 = require("./badge");
const updater_1 = require("./updater");
const constants_1 = require("../shared/constants");
let tray = null;
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
function trayImage() {
    const source = electron_1.nativeImage.createFromPath(path_1.default.join(__dirname, "../../resources/tray.png"));
    // Исходник крупный (1024): уменьшаем сами, иначе система масштабирует грубо.
    const image = source.isEmpty() ? source : source.resize({ width: TRAY_SIZE, height: TRAY_SIZE, quality: "best" });
    if (process.platform !== "darwin" || image.isEmpty())
        return image;
    const { width, height } = image.getSize();
    const bitmap = image.toBitmap(); // BGRA, по 4 байта на точку
    for (let i = 0; i < bitmap.length; i += 4) {
        bitmap[i] = 0; // B
        bitmap[i + 1] = 0; // G
        bitmap[i + 2] = 0; // R
        // bitmap[i + 3] — прозрачность, её не трогаем: это и есть форма значка
    }
    const template = electron_1.nativeImage.createFromBitmap(bitmap, { width, height });
    template.setTemplateImage(true);
    return template;
}
function sendToRenderer(channel, ...args) {
    (0, mainWindow_1.getMainWindow)()?.webContents.send(channel, ...args);
}
function buildMenu() {
    return electron_1.Menu.buildFromTemplate([
        { label: "Открыть TrioZ Connect", click: () => (0, mainWindow_1.focusMainWindow)() },
        // FIX-BLANK: аварийный выход из «тёмного экрана» без переустановки —
        // сброс HTTP-кеша и перезагрузка страницы (сессия сохраняется).
        {
            label: "Перезагрузить без кеша",
            click: () => {
                const win = (0, mainWindow_1.getMainWindow)();
                if (!win)
                    return;
                (0, mainWindow_1.focusMainWindow)();
                // force: человек попросил сам — откладывать нечего, даже если идёт разговор.
                void (0, recovery_1.clearCacheAndReload)(win, "ручная перезагрузка из трея", { force: true });
            },
        },
        { type: "separator" },
        {
            label: "Заглушить / включить микрофон",
            click: () => sendToRenderer(constants_1.IPC.TOGGLE_MUTE),
        },
        { type: "separator" },
        // Only meaningful in packaged builds, where electron-updater has a feed to
        // query; in dev it just explains there is nothing to update.
        ...(electron_1.app.isPackaged
            ? [
                {
                    label: "Проверить обновления",
                    click: () => (0, updater_1.checkForUpdatesNow)(true),
                },
                { type: "separator" },
            ]
            : []),
        {
            label: "Выход",
            click: () => {
                (0, mainWindow_1.setQuitting)(true);
                electron_1.app.quit();
            },
        },
    ]);
}
function createTray() {
    if (tray)
        return;
    tray = new electron_1.Tray(trayImage());
    tray.setToolTip("TrioZ Connect");
    tray.setContextMenu(buildMenu());
    // Left-click toggles the window on Windows/Linux (standard behavior).
    tray.on("click", () => (0, mainWindow_1.focusMainWindow)());
    // Reflect the unread count in the tray tooltip.
    (0, badge_1.setBadgeListener)((total) => {
        if (!tray || tray.isDestroyed())
            return;
        tray.setToolTip(total > 0 ? `TrioZ Connect — ${total} непрочитанных` : "TrioZ Connect");
    });
}
function destroyTray() {
    tray?.destroy();
    tray = null;
}
//# sourceMappingURL=tray.js.map