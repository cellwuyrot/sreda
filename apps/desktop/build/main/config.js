"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConfig = getConfig;
exports.updateConfig = updateConfig;
const electron_store_1 = __importDefault(require("electron-store"));
const constants_1 = require("../shared/constants");
/* Проверка адреса вынесена в общий модуль и покрыта тестами. */
const navigation_1 = require("../shared/navigation");
/**
 * Persistent settings, stored as JSON in the OS-appropriate userData folder
 * (managed by electron-store). Environment variables win over stored values on
 * startup so that a developer can override the target server with
 * `TRIOZ_APP_URL=http://localhost:3000` without touching the saved config.
 */
const defaults = {
    appUrl: constants_1.DEFAULT_APP_URL,
    autoLaunch: false,
    minimizeToTray: true,
    nativeNotifications: true,
    toggleMuteShortcut: "CommandOrControl+Shift+M",
    pushToTalkShortcut: "",
    replayShortcut: "", // FIX-REPLAY: глобальный бинд «сохранить повтор» (пусто = выключен)
    replayFolder: "", // FIX-REPLAY: пусто = «Видео/TrioZ Replays» по умолчанию
    overlayEnabled: false, // FIX-OVL
    overlaySide: "right",
    overlayShowScreen: true,
};
const store = new electron_store_1.default({ name: "settings", defaults });
/**
 * FIX-DOMAIN2: разовый переезд со старого стандартного адреса на новый.
 *
 * Уже установленные клиенты держат адрес в settings.json, поэтому новая сборка
 * без этой замены продолжала бы открывать старый сервер.
 */
function migrateLegacyAppUrl() {
    try {
        const current = store.get("appUrl");
        if (typeof current !== "string")
            return;
        const normalized = current.replace(/\/+$/, "");
        if (constants_1.LEGACY_APP_URLS.includes(normalized)) {
            store.set("appUrl", constants_1.DEFAULT_APP_URL);
        }
    }
    catch {
        /* Недоступное хранилище не должно мешать запуску: адрес останется прежним. */
    }
}
migrateLegacyAppUrl();
/** Read the whole config, applying environment overrides for `appUrl`. */
function getConfig() {
    const stored = {
        appUrl: store.get("appUrl"),
        autoLaunch: store.get("autoLaunch"),
        minimizeToTray: store.get("minimizeToTray"),
        nativeNotifications: store.get("nativeNotifications"),
        toggleMuteShortcut: store.get("toggleMuteShortcut"),
        pushToTalkShortcut: store.get("pushToTalkShortcut"),
        replayShortcut: store.get("replayShortcut"), // FIX-REPLAY
        replayFolder: store.get("replayFolder"), // FIX-REPLAY
        overlayEnabled: store.get("overlayEnabled"), // FIX-OVL
        overlaySide: store.get("overlaySide"),
        overlayShowScreen: store.get("overlayShowScreen"),
    };
    const envUrl = process.env.TRIOZ_APP_URL;
    return {
        ...stored,
        appUrl: (0, navigation_1.sanitizeAppUrl)(envUrl ?? stored.appUrl, defaults.appUrl),
    };
}
/** Merge a partial update into the stored config and return the new value. */
function updateConfig(patch) {
    if (patch.appUrl !== undefined) {
        store.set("appUrl", (0, navigation_1.sanitizeAppUrl)(patch.appUrl, defaults.appUrl));
    }
    for (const key of [
        "autoLaunch",
        "minimizeToTray",
        "nativeNotifications",
        "toggleMuteShortcut",
        "pushToTalkShortcut",
        "replayShortcut", // FIX-REPLAY
        "replayFolder", // FIX-REPLAY
        "overlayEnabled", // FIX-OVL
        "overlaySide",
        "overlayShowScreen",
    ]) {
        if (patch[key] !== undefined) {
            store.set(key, patch[key]);
        }
    }
    return getConfig();
}
//# sourceMappingURL=config.js.map