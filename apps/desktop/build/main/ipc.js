"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIpc = registerIpc;
const electron_1 = require("electron");
const crypto_1 = require("crypto");
const path_1 = require("path"); // FIX-REPLAY
const fs_1 = require("fs"); // FIX-REPLAY
const constants_1 = require("../shared/constants");
const config_1 = require("./config");
const mainWindow_1 = require("./mainWindow");
const badge_1 = require("./badge");
const shortcuts_1 = require("./shortcuts");
const autoLaunch_1 = require("./autoLaunch");
const notificationBridge_1 = require("./notificationBridge");
const overlay_1 = require("./overlay"); // FIX-OVL
const updater_1 = require("./updater"); // UPD-BTN
const vpn_1 = require("./vpn"); // VPN-ONECLICK
/** Register every IPC endpoint the preload bridge relies on. */
function registerIpc() {
    electron_1.ipcMain.handle(constants_1.IPC.GET_INFO, () => {
        const { appUrl } = (0, config_1.getConfig)();
        return {
            isDesktop: true,
            version: electron_1.app.getVersion(),
            platform: process.platform,
            appUrl,
        };
    });
    electron_1.ipcMain.handle(constants_1.IPC.GET_CONFIG, () => (0, config_1.getConfig)());
    /* UPD-BTN: кнопка в углу окна спрашивает состояние при появлении — обновление
       могло скачаться до того, как страница загрузилась. */
    electron_1.ipcMain.handle(constants_1.IPC.GET_UPDATE_STATE, () => (0, updater_1.currentUpdateState)());
    electron_1.ipcMain.on(constants_1.IPC.INSTALL_UPDATE, () => {
        (0, updater_1.installDownloadedUpdate)();
    });
    /* VPN-ONECLICK: поднять/снять туннель и отдать его текущее состояние.
       Профиль приходит от renderer готовым (собран на устройстве, с приватным
       ключом, который по сети не передаётся) — main лишь исполняет команды ОС. */
    electron_1.ipcMain.handle(constants_1.IPC.VPN_UP, (_e, config) => (0, vpn_1.vpnUp)(typeof config === "string" ? config : ""));
    electron_1.ipcMain.handle(constants_1.IPC.VPN_DOWN, () => (0, vpn_1.vpnDown)());
    electron_1.ipcMain.handle(constants_1.IPC.VPN_STATUS, () => (0, vpn_1.vpnState)());
    electron_1.ipcMain.handle(constants_1.IPC.SET_CONFIG, (_e, patch) => {
        const previous = (0, config_1.getConfig)();
        const next = (0, config_1.updateConfig)(patch ?? {});
        if (next.toggleMuteShortcut !== previous.toggleMuteShortcut ||
            next.pushToTalkShortcut !== previous.pushToTalkShortcut ||
            next.replayShortcut !== previous.replayShortcut // FIX-REPLAY
        ) {
            (0, shortcuts_1.registerShortcuts)();
        }
        if (next.autoLaunch !== previous.autoLaunch) {
            (0, autoLaunch_1.applyAutoLaunch)(next.autoLaunch);
        }
        if (next.appUrl !== previous.appUrl) {
            (0, mainWindow_1.getMainWindow)()?.loadURL(next.appUrl).catch(() => undefined);
            void (0, notificationBridge_1.refreshNotificationBridge)();
        }
        // FIX-OVL: изменились настройки оверлея — пересчитать его видимость/позицию.
        if (next.overlayEnabled !== previous.overlayEnabled ||
            next.overlaySide !== previous.overlaySide ||
            next.overlayShowScreen !== previous.overlayShowScreen) {
            (0, overlay_1.syncOverlay)();
        }
        return next;
    });
    // ── Очистка HTTP-кеша (безопасно, без выхода из аккаунта) ──────────
    // session.clearCache() сбрасывает дисковый кеш Chromium: изображения,
    // шрифты, скрипты, стили — всё то, что браузер хранит для ускорения
    // повторных загрузок. Куки и localStorage при этом не затрагиваются.
    electron_1.ipcMain.handle(constants_1.IPC.CLEAR_CACHE, async () => {
        await electron_1.session.defaultSession.clearCache();
    });
    // ── Глубокий сброс хранилища (указанные типы) ──────────────────────
    // clearStorageData позволяет точечно выбрать, что именно удалить.
    // При передаче "cookies" пользователь будет разлогинен.
    electron_1.ipcMain.handle(constants_1.IPC.CLEAR_STORAGE, async (_e, storages) => {
        await electron_1.session.defaultSession.clearStorageData({
            storages: storages,
        });
    });
    electron_1.ipcMain.on(constants_1.IPC.SET_BADGE, (_e, count) => {
        if (typeof count === "number" && Number.isFinite(count))
            (0, badge_1.setBadgeFromRenderer)(count);
    });
    // Веб-приложение только что пометило сообщения прочитанными — переопрашиваем
    // непрочитанные каналы, не дожидаясь 30-секундного поллинга. Багфикс: раньше
    // здесь вызывался resetDmUnread(), и прочтение ОБЫЧНОГО канала гасило счётчик
    // непрочитанных ЛС. Счётчик ЛС теперь сбрасывается только при фокусе окна
    // (см. badge.ts — startBadgePolling).
    electron_1.ipcMain.on(constants_1.IPC.REFRESH_BADGE, () => void (0, badge_1.refreshBadge)());
    // НОВОЕ: стабильный ID устройства — SHA-256-хэш MAC-адресов внешних сетевых
    // интерфейсов. Веб-приложение передаёт его на сервер, чтобы при глобальном
    // бане учётная запись останавливалась по IP и MAC-адресу.
    electron_1.ipcMain.handle(constants_1.IPC.GET_DEVICE_ID, () => computeDeviceId());
    electron_1.ipcMain.on(constants_1.IPC.FOCUS_WINDOW, () => (0, mainWindow_1.focusMainWindow)());
    // FIX-NAV1: мягкая навигация по запросу renderer (клик по нижней плашке
    // статус-бара и т.п.). navigate() сам решает: переслать путь в SPA через
    // IPC.NAVIGATE (без перезагрузки — голосовой канал не рвётся) или, если
    // приложение ещё не загружено, выполнить полную загрузку как запасной путь.
    electron_1.ipcMain.on(constants_1.IPC.NAVIGATE_REQUEST, (_e, path) => {
        if (typeof path === "string" && path.trim())
            (0, mainWindow_1.navigate)(path);
    });
    // НОВОЕ: PiP-режим демонстрации экрана — «свернуть до мини-окна» превращает
    // окно приложения в маленькое окно поверх всех окон ОС (и обратно).
    electron_1.ipcMain.on(constants_1.IPC.SET_PIP, (_e, enabled) => (0, mainWindow_1.setPipMode)(enabled === true));
    electron_1.ipcMain.on(constants_1.IPC.SET_SCREEN_SHARE_ACTIVE, (_e, active) => (0, mainWindow_1.setScreenShareActive)(active === true));
    // FIX-OVL: состояние голосового чата для оверлея + действия из окна оверлея.
    electron_1.ipcMain.on(constants_1.IPC.VOICE_OVERLAY_STATE, (_e, state) => (0, overlay_1.updateVoiceOverlayState)(state ?? null));
    electron_1.ipcMain.on(constants_1.IPC.OVERLAY_ACTION, (_e, action) => (0, overlay_1.handleOverlayAction)(String(action)));
    // FIX-OVL-SIZE: авто-высота окна оверлея по фактическому контенту.
    electron_1.ipcMain.on(constants_1.IPC.OVERLAY_RESIZE, (_e, height) => (0, overlay_1.handleOverlayResize)(Number(height)));
    // FIX-OVL-DRAG2: перетаскивание окна оверлея мышью.
    electron_1.ipcMain.on(constants_1.IPC.OVERLAY_MOVE_START, (_e, point) => (0, overlay_1.handleOverlayMoveStart)(Number(point?.x), Number(point?.y)));
    electron_1.ipcMain.on(constants_1.IPC.OVERLAY_MOVE, (_e, point) => (0, overlay_1.handleOverlayMove)(Number(point?.x), Number(point?.y)));
    electron_1.ipcMain.on(constants_1.IPC.OVERLAY_MOVE_END, () => (0, overlay_1.handleOverlayMoveEnd)());
    // FIX-REPLAY: записать файл мгновенного повтора в настроенную папку.
    // Данные приходят из renderer уже готовым контейнером (WebM); main-процесс
    // только кладёт байты на диск — никакой сети и сервера.
    electron_1.ipcMain.handle(constants_1.IPC.REPLAY_WRITE, async (_e, data, ext) => {
        try {
            const cfg = (0, config_1.getConfig)();
            const dir = cfg.replayFolder || (0, path_1.join)(electron_1.app.getPath("videos"), "TrioZ Replays");
            await fs_1.promises.mkdir(dir, { recursive: true });
            const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
            const safeExt = /^[a-z0-9]{1,5}$/i.test(ext) ? ext.toLowerCase() : "webm";
            const file = (0, path_1.join)(dir, `TrioZ Replay ${stamp}.${safeExt}`);
            await fs_1.promises.writeFile(file, Buffer.from(new Uint8Array(data)));
            return file;
        }
        catch (err) {
            console.warn("[replay] failed to write file:", err);
            return null;
        }
    });
    // FIX-REPLAY: системный диалог выбора папки для повторов; выбор сохраняется в конфиге.
    electron_1.ipcMain.handle(constants_1.IPC.REPLAY_CHOOSE_FOLDER, async () => {
        const win = (0, mainWindow_1.getMainWindow)();
        const opts = {
            title: "Папка для сохранения повторов",
            properties: ["openDirectory", "createDirectory"],
        };
        const res = win ? await electron_1.dialog.showOpenDialog(win, opts) : await electron_1.dialog.showOpenDialog(opts);
        if (res.canceled || !res.filePaths.length)
            return null;
        (0, config_1.updateConfig)({ replayFolder: res.filePaths[0] });
        return res.filePaths[0];
    });
}
/**
 * Stable application-profile ID. Never derive identity from network adapters:
 * VPN clients add/remove virtual MAC addresses and used to change this value,
 * which made the server treat one installation as a different device.
 */
function computeDeviceId() {
    const basis = `${process.platform}:${electron_1.app.getPath("userData")}:trioz-device-v2`;
    return (0, crypto_1.createHash)("sha256").update(basis).digest("hex").slice(0, 32);
}
//# sourceMappingURL=ipc.js.map