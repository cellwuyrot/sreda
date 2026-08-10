import Store from "electron-store";
import { DEFAULT_APP_URL } from "../shared/constants";
/* Проверка адреса вынесена в общий модуль и покрыта тестами. */
import { sanitizeAppUrl } from "../shared/navigation";
import type { DesktopConfig } from "../shared/types";

/**
 * Persistent settings, stored as JSON in the OS-appropriate userData folder
 * (managed by electron-store). Environment variables win over stored values on
 * startup so that a developer can override the target server with
 * `TRIOZ_APP_URL=http://localhost:3000` without touching the saved config.
 */
const defaults: DesktopConfig = {
  appUrl: DEFAULT_APP_URL,
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

const store = new Store<DesktopConfig>({ name: "settings", defaults });

/** Read the whole config, applying environment overrides for `appUrl`. */
export function getConfig(): DesktopConfig {
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
  } satisfies DesktopConfig;

  const envUrl = process.env.TRIOZ_APP_URL;
  return {
    ...stored,
    appUrl: sanitizeAppUrl(envUrl ?? stored.appUrl, defaults.appUrl),
  };
}

/** Merge a partial update into the stored config and return the new value. */
export function updateConfig(patch: Partial<DesktopConfig>): DesktopConfig {
  if (patch.appUrl !== undefined) {
    store.set("appUrl", sanitizeAppUrl(patch.appUrl, defaults.appUrl));
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
  ] as const) {
    if (patch[key] !== undefined) {
      store.set(key, patch[key] as never);
    }
  }
  return getConfig();
}
