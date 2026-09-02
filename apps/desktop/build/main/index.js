"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const config_1 = require("./config");
const mainWindow_1 = require("./mainWindow");
const tray_1 = require("./tray");
const screenShare_1 = require("./screenShare");
const shortcuts_1 = require("./shortcuts");
const badge_1 = require("./badge");
const notificationBridge_1 = require("./notificationBridge");
const updater_1 = require("./updater");
const autoLaunch_1 = require("./autoLaunch");
const ipc_1 = require("./ipc");
const wasapiCapture_1 = require("./wasapiCapture"); // WASAPI-SS
const recovery_1 = require("./recovery"); // FIX-BLANK
const mediaCache_1 = require("./mediaCache"); // FIX-CLIENTMEDIA
const overlay_1 = require("./overlay"); // FIX-OVL
const activity_1 = require("./activity"); // FIX-ACT
const vpn_1 = require("./vpn"); // VPN-ONECLICK
const deepLinks_1 = require("./deepLinks");
// The installed desktop client must start the mic -> AudioWorklet -> WebRTC
// graph even after a microphone permission prompt consumes user activation.
// This has to be set before app.whenReady().
electron_1.app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
// FIX-CLIENTMEDIA: схему локального кеша картинок нужно объявить привилегированной
// ДО app.whenReady() — иначе Chromium посчитает её небезопасной и заблокирует
// изображения на https-странице.
(0, mediaCache_1.registerMediaCacheScheme)();
// FIX-NTF: без AppUserModelId Windows не показывает нативные тосты Electron —
// уведомления из раздела «Уведомления» молча пропадали в десктоп-версии.
// Значение совпадает с appId из electron-builder.yml, чтобы тосты корректно
// привязывались к ярлыку установленного приложения.
if (process.platform === "win32") {
    electron_1.app.setAppUserModelId("ru.trioz.connect.desktop");
}
// ── Single-instance lock ────────────────────────────────────────────
// A second launch (e.g. clicking a trioz:// link) must forward to the running
// instance rather than starting a new one.
const gotLock = electron_1.app.requestSingleInstanceLock();
if (!gotLock) {
    electron_1.app.quit();
}
else {
    electron_1.app.on("second-instance", (_event, argv) => {
        const link = (0, deepLinks_1.deepLinkFromArgv)(argv);
        if (link)
            (0, deepLinks_1.handleDeepLink)(link);
        const win = (0, mainWindow_1.getMainWindow)();
        if (win) {
            if (win.isMinimized())
                win.restore();
            win.show();
            win.focus();
        }
    });
    (0, deepLinks_1.registerProtocol)();
    // macOS delivers deep links through this event.
    electron_1.app.on("open-url", (event, url) => {
        event.preventDefault();
        (0, deepLinks_1.handleDeepLink)(url);
    });
    electron_1.app.whenReady().then(onReady);
}
/**
 * Install the smallest application menu that keeps the OS clipboard shortcuts
 * working.
 *
 * On macOS the standard clipboard accelerators (⌘C/⌘V/⌘X/⌘A, undo/redo) are
 * dispatched *through* the application menu's Edit roles. With no menu at all
 * those keystrokes silently do nothing inside the web page — which is exactly
 * why copy/paste felt broken in the desktop client. We therefore give macOS a
 * tiny App / Edit / Window template (the Edit role already carries every
 * clipboard command with the right accelerators).
 *
 * On Windows/Linux Chromium handles those shortcuts inside editable fields on
 * its own, and an application menu would re-introduce the unwanted bar at the
 * top of secondary windows (e.g. the voice overlay), so there we install no
 * menu at all — matching the previous behaviour.
 */
function installApplicationMenu() {
    if (process.platform !== "darwin") {
        electron_1.Menu.setApplicationMenu(null);
        return;
    }
    const template = [
        { role: "appMenu" },
        { role: "editMenu" },
        { role: "windowMenu" },
    ];
    electron_1.Menu.setApplicationMenu(electron_1.Menu.buildFromTemplate(template));
}
function onReady() {
    const config = (0, config_1.getConfig)();
    // FIX-BLANK: клиент обновился (electron-updater) → сборка веб-части почти
    // наверняка сменилась, а Next.js на каждую сборку выпускает новые имена
    // чанков. Сбрасываем HTTP-кеш до создания окна, иначе закешированный HTML
    // прошлой сборки запросит удалённые /_next/static/* и мы получим пустой
    // (тёмный) экран. Cookie не трогаем — сессия сохраняется.
    void (0, recovery_1.invalidateCacheOnVersionChange)();
    // FIX-CLIENTMEDIA: аватары, иконки сообществ и фоны отдаются с локального
    // диска — сервер их больше не пережимает и не отдаёт повторно. Ставим до
    // создания окна, чтобы перехват работал с самого первого рендера.
    try {
        (0, mediaCache_1.installMediaCache)(new URL(config.appUrl).origin);
    }
    catch (err) {
        console.warn("[media-cache] не удалось включить локальный кеш изображений:", err);
    }
    installApplicationMenu();
    (0, ipc_1.registerIpc)();
    (0, wasapiCapture_1.registerWasapiIpc)(); // WASAPI-SS
    (0, screenShare_1.setupScreenShare)();
    const win = (0, mainWindow_1.createMainWindow)();
    // FIX-OVL: оверлей появляется/исчезает вслед за состоянием главного окна.
    // Каст обходит излишне строгие overload'ы типов BrowserWindow.on в Electron.
    const onWindowEvent = win.on.bind(win);
    for (const evt of ["minimize", "restore", "show", "hide", "focus", "blur"]) {
        onWindowEvent(evt, () => (0, overlay_1.syncOverlay)());
    }
    (0, tray_1.createTray)();
    (0, shortcuts_1.registerShortcuts)();
    (0, badge_1.startBadgePolling)();
    (0, activity_1.startActivityWatcher)(); // FIX-ACT: сканирование процессов для статуса-активности
    (0, autoLaunch_1.applyAutoLaunch)(config.autoLaunch);
    (0, updater_1.initAutoUpdate)();
    // Bring up the notification socket once the frontend has loaded (and thus the
    // session cookie is available), and again whenever the session changes.
    win.webContents.on("did-finish-load", () => {
        void (0, notificationBridge_1.refreshNotificationBridge)();
        (0, activity_1.resendActivity)(); // FIX-ACT: страница перезагрузилась — повторяем текущую активность
    });
    win.webContents.on("did-navigate", () => void (0, notificationBridge_1.refreshNotificationBridge)());
    electron_1.session.defaultSession.cookies.on("changed", (_e, cookie) => {
        if (cookie.name.includes("next-auth.session-token"))
            void (0, notificationBridge_1.refreshNotificationBridge)();
    });
    // A deep link may have arrived during startup (Windows initial argv / macOS).
    const initialLink = (0, deepLinks_1.deepLinkFromArgv)(process.argv);
    if (initialLink)
        (0, deepLinks_1.handleDeepLink)(initialLink);
    (0, deepLinks_1.flushPendingDeepLink)();
    electron_1.app.on("activate", () => {
        // macOS: re-create the window when the dock icon is clicked and none exist.
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            (0, mainWindow_1.createMainWindow)();
        else
            (0, mainWindow_1.getMainWindow)()?.show();
    });
}
// When every window is truly closed (tray disabled), quit — except on macOS
// where apps conventionally stay alive.
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        electron_1.app.quit();
});
electron_1.app.on("before-quit", (event) => {
    (0, mainWindow_1.setQuitting)(true);
    (0, recovery_1.stopCacheMaintenance)(); // FIX-BLANK2
    (0, overlay_1.destroyOverlay)(); // FIX-OVL
    (0, shortcuts_1.unregisterShortcuts)();
    (0, badge_1.stopBadgePolling)();
    (0, activity_1.stopActivityWatcher)(); // FIX-ACT
    (0, notificationBridge_1.stopNotificationBridge)();
    (0, tray_1.destroyTray)();
    /* VPN-ONECLICK: туннель обязан сняться до выхода. В режиме «весь трафик»
       оставленный поднятым туннель замкнул бы на сервер всю машину, а окна, чтобы
       это отменить, уже не было бы. Откладываем выход на один проход: снимаем
       туннель и выходим повторно — второй before-quit уже ничего не ждёт. */
    if ((0, vpn_1.isVpnActive)()) {
        event.preventDefault();
        void (0, vpn_1.shutdownVpn)().finally(() => electron_1.app.quit());
    }
});
//# sourceMappingURL=index.js.map