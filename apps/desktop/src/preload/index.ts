import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC } from "../shared/constants";
import type {
  DesktopConfig,
  DesktopInfo,
  DeepLinkPayload,
  DesktopNotification,
  DesktopUpdateState,
  ScreenShareContext,
  ScreenSource,
} from "../shared/types";
import { initUpdateButton } from "./updateButton";

/**
 * The `window.triozDesktop` API — the entire contract between the native shell
 * and the web frontend. The web app can feature-detect it (`window.triozDesktop`
 * is undefined in a normal browser) and, when present, opt into native
 * behaviors: pushing an exact unread count, reacting to global mute/push-to-talk
 * hotkeys, and following `trioz://` deep links.
 *
 * Everything is funnelled through a small, explicit surface — no direct access
 * to Node or Electron internals is exposed to the page.
 */
type Unsubscribe = () => void;

function on(channel: string, handler: (...args: unknown[]) => void): Unsubscribe {
  const listener = (_event: IpcRendererEvent, ...args: unknown[]) => handler(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  isDesktop: true as const,
  platform: process.platform,

  /** Static info about the shell (version, platform, target URL). */
  getInfo: (): Promise<DesktopInfo> => ipcRenderer.invoke(IPC.GET_INFO),

  /** Read the persisted desktop settings. */
  getConfig: (): Promise<DesktopConfig> => ipcRenderer.invoke(IPC.GET_CONFIG),

  /** Update desktop settings; returns the merged result. */
  setConfig: (patch: Partial<DesktopConfig>): Promise<DesktopConfig> =>
    ipcRenderer.invoke(IPC.SET_CONFIG, patch),

  /**
   * Clears the Chromium HTTP/disk cache (images, scripts, fonts, styles).
   * Safe — does NOT touch cookies or localStorage, so the user stays logged in.
   */
  clearCache: (): Promise<void> => ipcRenderer.invoke(IPC.CLEAR_CACHE),

  /**
   * Clears the specified Chromium storage types.
   * Passing `["cookies"]` will log the user out.
   * Available types: 'appcache' | 'cookies' | 'filesystem' | 'indexdb' |
   *   'localstorage' | 'shadercache' | 'websql' | 'serviceworkers' | 'cachestorage'
   */
  clearStorageData: (storages: string[]): Promise<void> =>
    ipcRenderer.invoke(IPC.CLEAR_STORAGE, storages),

  /** Push an exact unread count; takes over from the shell's own polling. */
  setBadgeCount: (count: number): void => ipcRenderer.send(IPC.SET_BADGE, count),

  /** NEW: попросить оболочку немедленно пересчитать цифру на значке. */
  refreshBadge: (): void => ipcRenderer.send(IPC.REFRESH_BADGE),

  /** НОВОЕ: стабильный ID устройства (SHA-256 от MAC-адресов) для блокировок. */
  getDeviceId: (): Promise<string> => ipcRenderer.invoke(IPC.GET_DEVICE_ID),

  /** Bring the app window to the foreground. */
  focus: (): void => ipcRenderer.send(IPC.FOCUS_WINDOW),

  /**
   * НОВОЕ: PiP-режим демонстрации экрана. true — окно приложения сжимается
   * до мини-окна поверх всех окон ОС (перетаскивается за шапку мини-плеера),
   * false — прежние размеры и состояние восстанавливаются.
   */
  setPipMode: (enabled: boolean): void => ipcRenderer.send(IPC.SET_PIP, enabled),

  /** Сообщить main-процессу, что активную демонстрацию можно свернуть в PiP. */
  setScreenShareActive: (active: boolean): void => ipcRenderer.send(IPC.SET_SCREEN_SHARE_ACTIVE, active),
  /** FIX-OVL: передать состояние голосового чата для оверлея. */
  sendVoiceOverlayState: (state: unknown): void => ipcRenderer.send(IPC.VOICE_OVERLAY_STATE, state),

  /** Системная кнопка сворачивания перевела окно в PiP. */
  onPipModeChange: (cb: (enabled: boolean) => void): Unsubscribe =>
    on(IPC.PIP_MODE_CHANGED, (enabled) => cb(enabled === true)),

  /**
   * Сообщить оболочке выбор для следующей демонстрации — источник, качество,
   * звук и тариф — прямо перед запросом медиа. Раньше это была затравка для
   * окна запуска оболочки; теперь спрашивает приложение, а оболочка исполняет.
   */
  prepareScreenShare: (ctx: ScreenShareContext): Promise<void> =>
    ipcRenderer.invoke(IPC.PREPARE_SCREEN_SHARE, ctx),

  /**
   * Экраны и окна с превью — для окна запуска показа в приложении. Список
   * доступен только оболочке: браузеру перечислить окна ОС нечем.
   */
  getScreenSources: (): Promise<ScreenSource[]> =>
    ipcRenderer.invoke(IPC.GET_SCREEN_SOURCES),

  /** Global mute-toggle hotkey was pressed. */
  onToggleMute: (cb: () => void): Unsubscribe => on(IPC.TOGGLE_MUTE, () => cb()),

  /** Push-to-talk hotkey pulse. */
  onPushToTalk: (cb: () => void): Unsubscribe => on(IPC.PUSH_TO_TALK, () => cb()),

  /** FIX-REPLAY: глобальный бинд «сохранить мгновенный повтор» нажат. */
  onSaveReplay: (cb: () => void): Unsubscribe => on(IPC.SAVE_REPLAY, () => cb()),

  /**
   * FIX-REPLAY: записать файл повтора в настроенную папку (или «Видео/TrioZ
   * Replays» по умолчанию). Возвращает полный путь файла или null при ошибке.
   */
  saveReplayFile: (data: ArrayBuffer, ext: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.REPLAY_WRITE, data, ext),

  /** FIX-REPLAY: выбрать папку для повторов (диалог ОС); выбор сохраняется в конфиге. */
  chooseReplayFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.REPLAY_CHOOSE_FOLDER),

  /** A `trioz://` deep link was opened. */
  onDeepLink: (cb: (payload: DeepLinkPayload) => void): Unsubscribe =>
    on(IPC.DEEP_LINK, (payload) => cb(payload as DeepLinkPayload)),

  /** The shell asked the app to navigate somewhere. */
  onNavigate: (cb: (path: string) => void): Unsubscribe =>
    on(IPC.NAVIGATE, (path) => cb(path as string)),

  /**
   * A notification/DM arrived. Показывает его система; веб-часть может
   * подписаться и дополнительно показать подсказку внутри страницы.
   */
  onNotification: (cb: (n: DesktopNotification) => void): Unsubscribe =>
    on(IPC.NOTIFICATION, (n) => cb(n as DesktopNotification)),

  /** UPD-BTN: что сейчас с обновлением. */
  getUpdateState: (): Promise<DesktopUpdateState> => ipcRenderer.invoke(IPC.GET_UPDATE_STATE),

  /** UPD-BTN: обновление скачивается или готово к установке. */
  onUpdateState: (cb: (state: DesktopUpdateState) => void): Unsubscribe =>
    on(IPC.UPDATE_STATE, (state) => cb(state as DesktopUpdateState)),

  /** UPD-BTN: поставить скачанное обновление. Приложение перезапустится само. */
  installUpdate: (): void => ipcRenderer.send(IPC.INSTALL_UPDATE),

  /** FIX-ACT: обнаруженная активность пользователя на ПК («Слушает музыку в Spotify» или null). */
  onActivity: (cb: (label: string | null) => void): Unsubscribe =>
    on(IPC.ACTIVITY_CHANGED, (label) => cb(typeof label === "string" ? label : null)),
};

export type TriozDesktopApi = typeof api;

contextBridge.exposeInMainWorld("triozDesktop", api);

/*
 * UPD-BTN: единственное, что оболочка рисует поверх страницы, — кнопка
 * обновления в правом верхнем углу. Нижняя плашка с уведомлениями убрана:
 * уведомления показывает система, а полоса в 28 точек просто отъедала высоту у
 * переписки и дублировала то, что и так видно в шторке.
 */
initUpdateButton(
  (handler) => on(IPC.UPDATE_STATE, (state) => handler(state as DesktopUpdateState)),
  () => ipcRenderer.invoke(IPC.GET_UPDATE_STATE) as Promise<DesktopUpdateState>,
  () => ipcRenderer.send(IPC.INSTALL_UPDATE),
);
