/**
 * Typed accessor for the `window.triozDesktop` bridge exposed by the Electron
 * shell's preload script (`apps/desktop/src/preload/index.ts`). In a normal
 * browser the object is absent, so every consumer must treat it as optional and
 * feature-detect with {@link getDesktopApi}.
 *
 * Only the slice of the bridge the web app actually uses is typed here; the
 * source of truth for the full surface lives in the desktop workspace.
 */

/** Mirror of the desktop shell's persisted configuration (subset we touch). */
export interface DesktopConfig {
  appUrl: string;
  autoLaunch: boolean;
  minimizeToTray: boolean;
  nativeNotifications: boolean;
  /** Global accelerator that toggles microphone mute (empty = disabled). */
  toggleMuteShortcut: string;
  /** Global accelerator used for push-to-talk (empty = disabled). */
  pushToTalkShortcut: string;
  /** FIX-OVL: оверлей голосового чата при свёрнутом окне (опционально — старые сборки шелла полей не знают). */
  overlayEnabled?: boolean;
  overlaySide?: "left" | "right";
  overlayShowScreen?: boolean;
  /** FIX-REPLAY: глобальный бинд «сохранить повтор» (пусто = выключен; нет в старых сборках). */
  replayShortcut?: string;
  /** FIX-REPLAY: папка для файлов повтора (пусто = «Видео/TrioZ Replays»; нет в старых сборках). */
  replayFolder?: string;
}

type Unsubscribe = () => void;

/** Streaming options chosen in the native screen-share picker. */
export interface DesktopScreenShareOptions {
  resolution: 720 | 1080;
  fps: 30 | 60;
  /** Whether the source's system/loopback audio should be captured too. */
  audio: boolean;
}

/** Экран или окно, которое можно показать: перечисляет только оболочка. */
export interface DesktopScreenSource {
  id: string;
  name: string;
  /** Превью как data-URL — страница живёт на https, файлы диска ей закрыты. */
  thumbnail: string;
  /** `true` — целый экран, `false` — окно приложения. */
  isScreen: boolean;
}

/**
 * Выбор, который приложение сообщает оболочке перед запросом медиа: источник,
 * качество и звук. Раньше оболочка спрашивала это сама, вторым окном.
 */
export interface DesktopScreenShareContext extends DesktopScreenShareOptions {
  isPremium: boolean;
  /** Идентификатор источника; `null` — пусть оболочка возьмёт целый экран. */
  sourceId: string | null;
}

export interface TriozDesktopApi {
  isDesktop: true;
  platform: string;
  getConfig(): Promise<DesktopConfig>;
  setConfig(patch: Partial<DesktopConfig>): Promise<DesktopConfig>;
  /** Global mute-toggle hotkey was pressed. */
  onToggleMute(cb: () => void): Unsubscribe;
  /** Push-to-talk hotkey pulse. */
  onPushToTalk(cb: () => void): Unsubscribe;
  /**
   * Сообщить оболочке выбор для следующей демонстрации (источник, качество,
   * звук, тариф) прямо перед запросом медиа. Нет в старых сборках — обязательно
   * feature-detect.
   */
  prepareScreenShare?(ctx: DesktopScreenShareContext): Promise<void>;
  /**
   * Экраны и окна с превью для окна запуска показа. Нет в старых сборках
   * оболочки: там источник выбирался в её собственном окне.
   */
  getScreenSources?(): Promise<DesktopScreenSource[]>;
  /**
   * NEW: попросить оболочку немедленно пересчитать счётчик непрочитанного
   * на значке приложения (после прочтения). Нет в старых сборках — всегда
   * вызывать через опциональную цепочку.
   */
  refreshBadge?(): void;
  /**
   * НОВОЕ: стабильный ID устройства (хэш MAC-адресов). Нет в старых сборках —
   * всегда вызывать через опциональную цепочку.
   */
  getDeviceId?(): Promise<string>;
  /**
   * НОВОЕ: PiP-режим демонстрации экрана — окно приложения сжимается до
   * мини-окна поверх всех окон ОС (и обратно). Нет в старых сборках — всегда
   * вызывать через опциональную цепочку.
   */
  setPipMode?(enabled: boolean): void;
  /** Активная демонстрация позволяет main-процессу заменить minimize на PiP. */
  setScreenShareActive?(active: boolean): void;
  /** Системное сворачивание включило PiP в main-процессе. */
  onPipModeChange?(cb: (enabled: boolean) => void): Unsubscribe;
  /** FIX-OVL: передать в шелл состояние голосового чата для оверлея. */
  sendVoiceOverlayState?(state: { inVoice: boolean; channelName: string | null; users: Array<{ id: string; name: string; speaking: boolean; muted: boolean; deafened: boolean; self: boolean }>; screenThumb: string | null; sharerName: string | null }): void;
  /**
   * FIX-ACT: активность пользователя на ПК от шелла («Слушает музыку в Spotify»
   * или null). Нет в старых сборках — обязательно feature-detect.
   */
  onActivity?(cb: (label: string | null) => void): Unsubscribe;
  /** FIX-REPLAY: глобальный бинд «сохранить повтор» нажат. Нет в старых сборках — feature-detect. */
  onSaveReplay?(cb: () => void): Unsubscribe;
  /** FIX-REPLAY: записать файл повтора в настроенную папку. Возвращает путь или null. Нет в старых сборках. */
  saveReplayFile?(data: ArrayBuffer, ext: string): Promise<string | null>;
  /** FIX-REPLAY: выбрать папку для повторов (системный диалог). Нет в старых сборках. */
  chooseReplayFolder?(): Promise<string | null>;
  /**
   * FIX-NAV1: оболочка просит приложение перейти по внутреннему пути (клик по
   * уведомлению / нижней плашке статус-бара, deep link). Навигация МЯГКАЯ — без
   * перезагрузки страницы, поэтому активный голосовой канал не рвётся. Нет в
   * старых сборках шелла — обязательно feature-detect.
   */
  onNavigate?(cb: (path: string) => void): Unsubscribe;
}

declare global {
  interface Window {
    triozDesktop?: TriozDesktopApi;
  }
}

/** Return the desktop bridge, or `null` when running in a plain browser. */
export function getDesktopApi(): TriozDesktopApi | null {
  if (typeof window === "undefined") return null;
  return window.triozDesktop ?? null;
}

/** Convenience flag: are we running inside the Electron desktop shell? */
export function isDesktop(): boolean {
  return getDesktopApi() !== null;
}
