"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const constants_1 = require("../shared/constants");
const updateButton_1 = require("./updateButton");
function on(channel, handler) {
    const listener = (_event, ...args) => handler(...args);
    electron_1.ipcRenderer.on(channel, listener);
    return () => electron_1.ipcRenderer.removeListener(channel, listener);
}
const api = {
    isDesktop: true,
    platform: process.platform,
    /** Static info about the shell (version, platform, target URL). */
    getInfo: () => electron_1.ipcRenderer.invoke(constants_1.IPC.GET_INFO),
    /** Read the persisted desktop settings. */
    getConfig: () => electron_1.ipcRenderer.invoke(constants_1.IPC.GET_CONFIG),
    /** Update desktop settings; returns the merged result. */
    setConfig: (patch) => electron_1.ipcRenderer.invoke(constants_1.IPC.SET_CONFIG, patch),
    /**
     * Clears the Chromium HTTP/disk cache (images, scripts, fonts, styles).
     * Safe — does NOT touch cookies or localStorage, so the user stays logged in.
     */
    clearCache: () => electron_1.ipcRenderer.invoke(constants_1.IPC.CLEAR_CACHE),
    /**
     * Clears the specified Chromium storage types.
     * Passing `["cookies"]` will log the user out.
     * Available types: 'appcache' | 'cookies' | 'filesystem' | 'indexdb' |
     *   'localstorage' | 'shadercache' | 'websql' | 'serviceworkers' | 'cachestorage'
     */
    clearStorageData: (storages) => electron_1.ipcRenderer.invoke(constants_1.IPC.CLEAR_STORAGE, storages),
    /** Push an exact unread count; takes over from the shell's own polling. */
    setBadgeCount: (count) => electron_1.ipcRenderer.send(constants_1.IPC.SET_BADGE, count),
    /** NEW: попросить оболочку немедленно пересчитать цифру на значке. */
    refreshBadge: () => electron_1.ipcRenderer.send(constants_1.IPC.REFRESH_BADGE),
    /** НОВОЕ: стабильный ID устройства (SHA-256 от MAC-адресов) для блокировок. */
    getDeviceId: () => electron_1.ipcRenderer.invoke(constants_1.IPC.GET_DEVICE_ID),
    /** Bring the app window to the foreground. */
    focus: () => electron_1.ipcRenderer.send(constants_1.IPC.FOCUS_WINDOW),
    /**
     * НОВОЕ: PiP-режим демонстрации экрана. true — окно приложения сжимается
     * до мини-окна поверх всех окон ОС (перетаскивается за шапку мини-плеера),
     * false — прежние размеры и состояние восстанавливаются.
     */
    setPipMode: (enabled) => electron_1.ipcRenderer.send(constants_1.IPC.SET_PIP, enabled),
    /** Сообщить main-процессу, что активную демонстрацию можно свернуть в PiP. */
    setScreenShareActive: (active) => electron_1.ipcRenderer.send(constants_1.IPC.SET_SCREEN_SHARE_ACTIVE, active),
    /** FIX-OVL: передать состояние голосового чата для оверлея. */
    sendVoiceOverlayState: (state) => electron_1.ipcRenderer.send(constants_1.IPC.VOICE_OVERLAY_STATE, state),
    /** Системная кнопка сворачивания перевела окно в PiP. */
    onPipModeChange: (cb) => on(constants_1.IPC.PIP_MODE_CHANGED, (enabled) => cb(enabled === true)),
    /**
     * Сообщить оболочке выбор для следующей демонстрации — источник, качество,
     * звук и тариф — прямо перед запросом медиа.
     */
    prepareScreenShare: (ctx) => electron_1.ipcRenderer.invoke(constants_1.IPC.PREPARE_SCREEN_SHARE, ctx),
    /**
     * Экраны и окна с превью — для окна запуска показа в приложении.
     */
    getScreenSources: () => electron_1.ipcRenderer.invoke(constants_1.IPC.GET_SCREEN_SOURCES),
    /** Global mute-toggle hotkey was pressed. */
    onToggleMute: (cb) => on(constants_1.IPC.TOGGLE_MUTE, () => cb()),
    /** Push-to-talk hotkey pulse. */
    onPushToTalk: (cb) => on(constants_1.IPC.PUSH_TO_TALK, () => cb()),
    /** FIX-REPLAY: глобальный бинд «сохранить мгновенный повтор» нажат. */
    onSaveReplay: (cb) => on(constants_1.IPC.SAVE_REPLAY, () => cb()),
    /**
     * FIX-REPLAY: записать файл повтора в настроенную папку.
     * Возвращает полный путь файла или null при ошибке.
     */
    saveReplayFile: (data, ext) => electron_1.ipcRenderer.invoke(constants_1.IPC.REPLAY_WRITE, data, ext),
    /** FIX-REPLAY: выбрать папку для повторов (диалог ОС). */
    chooseReplayFolder: () => electron_1.ipcRenderer.invoke(constants_1.IPC.REPLAY_CHOOSE_FOLDER),
    /** A `trioz://` deep link was opened. */
    onDeepLink: (cb) => on(constants_1.IPC.DEEP_LINK, (payload) => cb(payload)),
    /** The shell asked the app to navigate somewhere. */
    onNavigate: (cb) => on(constants_1.IPC.NAVIGATE, (path) => cb(path)),
    /**
     * A notification/DM arrived.
     */
    onNotification: (cb) => on(constants_1.IPC.NOTIFICATION, (n) => cb(n)),
    /** UPD-BTN: что сейчас с обновлением. */
    getUpdateState: () => electron_1.ipcRenderer.invoke(constants_1.IPC.GET_UPDATE_STATE),
    /** UPD-BTN: обновление скачивается или готово к установке. */
    onUpdateState: (cb) => on(constants_1.IPC.UPDATE_STATE, (state) => cb(state)),
    /** UPD-BTN: поставить скачанное обновление. Приложение перезапустится само. */
    installUpdate: () => electron_1.ipcRenderer.send(constants_1.IPC.INSTALL_UPDATE),
    /** FIX-ACT: обнаруженная активность пользователя на ПК. */
    onActivity: (cb) => on(constants_1.IPC.ACTIVITY_CHANGED, (label) => cb(typeof label === "string" ? label : null)),
    /**
     * VPN-ONECLICK: реальный туннель по кнопке.
     */
    vpn: {
        up: (config) => electron_1.ipcRenderer.invoke(constants_1.IPC.VPN_UP, config),
        down: () => electron_1.ipcRenderer.invoke(constants_1.IPC.VPN_DOWN),
        status: () => electron_1.ipcRenderer.invoke(constants_1.IPC.VPN_STATUS),
        onState: (cb) => on(constants_1.IPC.VPN_STATE, (state) => cb(state)),
    },
    // --- WASAPI-SS: нативный захват звука ОС (EXCLUDE PID приложения) ---
    /** Запустить нативный WASAPI loopback-захват. */
    startWasapiCapture: () => electron_1.ipcRenderer.invoke(constants_1.IPC.WASAPI_START),
    /** Остановить захват. */
    stopWasapiCapture: () => { electron_1.ipcRenderer.send(constants_1.IPC.WASAPI_STOP); },
    /** Подписка: захват готов (sampleRate, channels). Возвращает отписку. */
    onWasapiReady: (cb) => on(constants_1.IPC.WASAPI_READY, (p) => cb(p.sampleRate, p.channels)),
    /** Подписка: новый чанк PCM Float32Array. Возвращает отписку. */
    onWasapiChunk: (cb) => on(constants_1.IPC.WASAPI_CHUNK, (buf) => cb(new Float32Array(buf))),
    /** Подписка: ошибка захвата. Возвращает отписку. */
    onWasapiError: (cb) => on(constants_1.IPC.WASAPI_ERROR, (msg) => cb(msg)),
};
electron_1.contextBridge.exposeInMainWorld("triozDesktop", api);
/*
 * UPD-BTN: единственное, что оболочка рисует поверх страницы, — кнопка
 * обновления в правом верхнем углу.
 */
(0, updateButton_1.initUpdateButton)((handler) => on(constants_1.IPC.UPDATE_STATE, (state) => handler(state)), () => electron_1.ipcRenderer.invoke(constants_1.IPC.GET_UPDATE_STATE), () => electron_1.ipcRenderer.send(constants_1.IPC.INSTALL_UPDATE));
//# sourceMappingURL=index.js.map