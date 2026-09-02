"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.currentUpdateState = currentUpdateState;
exports.initAutoUpdate = initAutoUpdate;
exports.checkForUpdatesNow = checkForUpdatesNow;
exports.installDownloadedUpdate = installDownloadedUpdate;
const electron_1 = require("electron");
const electron_updater_1 = require("electron-updater");
const constants_1 = require("../shared/constants");
const mainWindow_1 = require("./mainWindow");
const CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
// Events are attached lazily and only once — both the background scheduler and
// the tray's "Проверить обновления" item funnel through here.
let wired = false;
// While an interactive check (tray menu) is in flight we surface the outcome —
// including "you're already up to date" — in a dialog. Background checks stay
// silent: о готовом обновлении сообщает кнопка в углу окна.
let interactiveCheck = false;
/**
 * Что сейчас с обновлением. Это же состояние читает кнопка в углу окна.
 *
 * ── Почему не окно с вопросом ───────────────────────────────────────────────
 *
 * Раньше готовое обновление объявляло о себе системным окном «Перезапустить
 * сейчас?». Оно всплывает поверх работы — посреди набора сообщения, посреди
 * звонка — и требует ответа, хотя ничего срочного не случилось: файл уже скачан
 * и подождёт сколько угодно. Теперь в углу тихо появляется кнопка; человек
 * нажмёт её, когда ему удобно, а если не нажмёт — обновление встанет при
 * следующем выходе, как и раньше.
 */
let state = { status: "idle" };
function currentUpdateState() {
    return state;
}
function setState(next) {
    state = next;
    const win = (0, mainWindow_1.getMainWindow)();
    if (!win || win.isDestroyed())
        return;
    win.webContents.send(constants_1.IPC.UPDATE_STATE, state);
}
/**
 * Wire up auto-updates via electron-updater. The update feed is configured at
 * build time through the `publish` section of electron-builder.yml. Updates are
 * only checked in packaged builds — in development there is nothing to update.
 *
 * The flow: on launch (and every {@link CHECK_INTERVAL}) we ask the feed whether
 * a newer version exists. `autoDownload` pulls it in the background; когда файл
 * оказался на диске, в углу окна появляется кнопка. This is what makes a new
 * build reach an already installed client without a manual reinstall — provided
 * the published `version` is strictly greater than the running one.
 */
function initAutoUpdate() {
    if (!electron_1.app.isPackaged)
        return;
    wireEvents();
    void runCheck(false);
    setInterval(() => void runCheck(false), CHECK_INTERVAL);
}
/**
 * Trigger an on-demand update check (e.g. from the tray menu). When
 * `interactive` is true we also tell the user when they are already on the
 * latest version, so the menu item always gives visible feedback.
 */
function checkForUpdatesNow(interactive = true) {
    if (!electron_1.app.isPackaged) {
        if (interactive) {
            void electron_1.dialog.showMessageBox({
                type: "info",
                message: "Обновления доступны только в установленной версии.",
                detail: "В режиме разработки обновлять нечего.",
            });
        }
        return;
    }
    wireEvents();
    void runCheck(interactive);
}
/**
 * Поставить скачанное обновление.
 *
 * Возвращает false, если ставить нечего: кнопка в окне могла остаться на экране
 * устаревшей, и это не повод перезапускать приложение впустую.
 *
 * Установка тихая: без мастера установки и без вопросов, приложение открывается
 * заново само. Для человека это выглядит как быстрая перезагрузка окна, а не как
 * «установка программы».
 */
function installDownloadedUpdate() {
    if (!electron_1.app.isPackaged || state.status !== "ready")
        return false;
    /* Дать текущему обращению завершиться: quitAndInstall сносит процесс на
       месте, и ответ по IPC до окна уже не дойдёт. */
    setImmediate(() => electron_updater_1.autoUpdater.quitAndInstall(true, true));
    return true;
}
function wireEvents() {
    if (wired)
        return;
    wired = true;
    electron_updater_1.autoUpdater.autoDownload = true;
    electron_updater_1.autoUpdater.autoInstallOnAppQuit = true;
    /* FIX-SEC: понижение версии запрещено. Иначе тот, кто управляет фидом или
       смог вмешаться в соединение, вернёт старую сборку с известной дырой —
       и она установится тихо, без вопросов. Черновики — тоже не автоматически. */
    electron_updater_1.autoUpdater.allowDowngrade = false;
    electron_updater_1.autoUpdater.allowPrerelease = false;
    electron_updater_1.autoUpdater.on("error", (err) => {
        console.warn("[updater] error:", err?.message ?? err);
        /* Кнопку убираем: обещать обновление, которое не скачалось, нельзя. */
        setState({ status: "idle" });
        if (interactiveCheck) {
            interactiveCheck = false;
            void electron_1.dialog.showMessageBox({
                type: "warning",
                message: "Не удалось проверить обновления.",
                detail: String(err?.message ?? err),
            });
        }
    });
    electron_updater_1.autoUpdater.on("update-available", (info) => {
        console.log("[updater] update available:", info.version);
        setState({ status: "downloading", version: info.version });
    });
    electron_updater_1.autoUpdater.on("download-progress", (progress) => {
        setState({
            status: "downloading",
            version: state.version,
            percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
        });
    });
    electron_updater_1.autoUpdater.on("update-not-available", (info) => {
        console.log("[updater] up to date:", info.version);
        setState({ status: "idle" });
        if (interactiveCheck) {
            interactiveCheck = false;
            void electron_1.dialog.showMessageBox({
                type: "info",
                message: "У вас последняя версия.",
                detail: `Установлена версия ${electron_1.app.getVersion()}.`,
            });
        }
    });
    electron_updater_1.autoUpdater.on("update-downloaded", (info) => {
        console.log("[updater] downloaded:", info.version);
        interactiveCheck = false;
        setState({ status: "ready", version: info.version });
    });
}
async function runCheck(interactive) {
    interactiveCheck = interactive;
    try {
        await electron_updater_1.autoUpdater.checkForUpdates();
    }
    catch (err) {
        // The "error" event above owns the interactive dialog; just log here.
        console.warn("[updater] check failed:", err?.message ?? err);
    }
}
//# sourceMappingURL=updater.js.map