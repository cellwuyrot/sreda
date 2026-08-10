/** Persisted user configuration for the desktop shell. */
export interface DesktopConfig {
  /** Web frontend URL to load. */
  appUrl: string;
  /** Launch the app automatically on OS login. */
  autoLaunch: boolean;
  /** Keep running in the tray when the window is closed. */
  minimizeToTray: boolean;
  /** Show native OS notifications for messages/mentions. */
  nativeNotifications: boolean;
  /** Global accelerator that toggles microphone mute (empty = disabled). */
  toggleMuteShortcut: string;
  /** Global accelerator used for push-to-talk (empty = disabled). */
  pushToTalkShortcut: string;
  /** FIX-REPLAY: глобальный бинд «сохранить мгновенный повтор» (пусто = выключен). */
  replayShortcut: string;
  /** FIX-REPLAY: папка для файлов повтора (пусто = «Видео/TrioZ Replays»). */
  replayFolder: string;
  /** FIX-OVL: показывать оверлей голосового чата, когда окно свёрнуто. */
  overlayEnabled: boolean;
  /** FIX-OVL: сторона экрана для оверлея. */
  overlaySide: "left" | "right";
  /** FIX-OVL: показывать превью демонстрации экрана в оверлее. */
  overlayShowScreen: boolean;
}

/** FIX-OVL: участник голосового канала в оверлее. */
export interface VoiceOverlayUser {
  id: string;
  name: string;
  /** Говорит прямо сейчас (индикатор речи). */
  speaking: boolean;
  /** Микрофон выключен (self-mute). */
  muted: boolean;
  /** Звук собеседников выключен (deafen). Достоверно известно только для себя. */
  deafened: boolean;
  /** Это локальный пользователь («вы»). */
  self: boolean;
}

/** FIX-OVL: состояние голосового чата, передаваемое из renderer в окно оверлея. */
export interface VoiceOverlayState {
  inVoice: boolean;
  channelName: string | null;
  users: VoiceOverlayUser[];
  /** JPEG data-URL превью активной демонстрации экрана (или null). */
  screenThumb: string | null;
  sharerName: string | null;
}

/** Static information about the running desktop shell, exposed to the page. */
export interface DesktopInfo {
  isDesktop: true;
  version: string;
  platform: NodeJS.Platform;
  appUrl: string;
}

/** Payload for a `trioz://` deep link resolved by the main process. */
export interface DeepLinkPayload {
  /** e.g. "invite" for `trioz://invite/<code>`. */
  type: string;
  /** The in-app path the renderer should navigate to, e.g. `/invite/abc`. */
  path: string;
  /** Convenience: the invite code when `type === "invite"`. */
  code?: string;
  /** The raw deep-link URL that was opened. */
  raw: string;
}

/** A screen/window source the user can pick for screen sharing. */
export interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
  /** `true` for a whole display, `false` for an application window. */
  isScreen: boolean;
}

/** Screen-share vertical resolution the user may pick (720p / 1080p). */
export type ScreenResolution = 720 | 1080;
/** Screen-share frame rate the user may pick (30 / 60 fps). */
export type ScreenFps = 30 | 60;

/** Параметры трансляции: качество и передавать ли звук источника. */
export interface ScreenShareOptions {
  resolution: ScreenResolution;
  fps: ScreenFps;
  /** Capture the source's system/loopback audio alongside the video. */
  audio: boolean;
}

/**
 * Что renderer сообщает оболочке прямо перед запросом медиа: выбранный
 * источник, качество и звук. Раньше это была лишь «затравка» для окна запуска
 * оболочки; теперь выбор целиком делается в приложении, а оболочка его
 * исполняет — второго окна с вопросами больше нет.
 */
export interface ScreenShareContext extends ScreenShareOptions {
  /** Premium unlocks 1080p and 60 fps; regular accounts are pinned to 720p/30. */
  isPremium: boolean;
  /**
   * Идентификатор источника из {@link ScreenSource}. `null` — источник не
   * выбран (старая сборка веб-части): оболочка возьмёт целый экран.
   */
  sourceId: string | null;
}

/**
 * A notification forwarded from the main process to the renderer.
 *
 * Показывает его система (нативный тост). Своей плашки внизу окна у оболочки
 * больше нет — веб-часть при желании подписывается на это событие сама.
 */
export interface DesktopNotification {
  /** `notification` for in-app notifications, `dm` for direct messages. */
  kind: "notification" | "dm";
  /** Short headline, e.g. the sender or the notification title. */
  title: string;
  /** One-line body/preview text. */
  body: string;
  /** In-app path to open when the entry is clicked, e.g. `/connect`. */
  link?: string;
  /** Epoch milliseconds when the shell received it. */
  receivedAt: number;
}

/**
 * UPD-BTN: состояние обновления, которое видит кнопка в углу окна.
 *
 *   idle        — обновлять нечего либо проверка не удалась;
 *   downloading — файл качается в фоне, человека это не касается;
 *   ready       — файл на диске, установка займёт секунды.
 */
export interface DesktopUpdateState {
  status: "idle" | "downloading" | "ready";
  /** Версия, которая приедет. */
  version?: string;
  /** Сколько скачано, 0..100. */
  percent?: number;
}
