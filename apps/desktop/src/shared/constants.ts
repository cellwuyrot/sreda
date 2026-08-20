/**
 * Constants for the desktop shell. The Socket.IO contract (path + event names)
 * is imported from the workspace package `@trioz/shared` so the shell and the
 * web server can never drift apart. Everything else here — the protocol scheme,
 * IPC channel names, the default target URL — is desktop-only.
 */

// The Socket.IO transport contract is defined once, in packages/shared, and
// re-exported here so existing `../shared/constants` imports keep working.
export { SOCKET_PATH, SOCKET_EVENTS } from "@trioz/shared";

/** Default web frontend origin to load when nothing is configured. */
export const DEFAULT_APP_URL = "https://trioz.ru";

/**
 * FIX-DOMAIN2: адреса, которые были стандартными раньше.
 *
 * electron-store записывает стандартные значения в settings.json при первом запуске,
 * и с того момента старый адрес перестаёт быть «стандартом» и становится выбором
 * пользователя — смена стандартного значения в сборке такой клиент не переучивает.
 * Поэтому записанный старый стандарт при запуске заменяется на новый (см. main/config.ts).
 * Адрес, введённый руками и не совпадающий со старым стандартом, остаётся как есть.
 */
export const LEGACY_APP_URLS = ["https://connect.trioz.ru", "http://connect.trioz.ru"] as const;

/**
 * The desktop shell is a dedicated TZ.Connect messaging client, so it always
 * opens straight into the `/connect` section instead of the marketing landing
 * page (the "windows" grid at `/`). See {@link BLOCKED_PATHS}.
 */
export const DEFAULT_START_PATH = "/connect";

/**
 * Web-only areas that must never surface inside the desktop shell. The landing
 * grid (`/`) and the `/projects`, `/pero` and `/library` storefront/lore
 * sections belong to the website; if navigation ever targets one of them the
 * shell bounces back to {@link DEFAULT_START_PATH}.
 */
export const BLOCKED_PATHS = ["/projects", "/pero", "/library"] as const;

/** Custom protocol used for deep links, e.g. `trioz://invite/abc123`. */
export const PROTOCOL = "trioz";

/**
 * IPC channels. `INVOKE_*` are request/response (ipcRenderer.invoke), the rest
 * are one-way pushes from main → renderer.
 */
export const IPC = {
  // renderer → main (invoke)
  GET_INFO: "desktop:get-info",
  GET_CONFIG: "desktop:get-config",
  SET_CONFIG: "desktop:set-config",
  /** Выбор для следующей демонстрации: источник, качество, звук и тариф. */
  PREPARE_SCREEN_SHARE: "desktop:prepare-screen-share",
  /** Список экранов и окон с превью для окна запуска показа в приложении. */
  GET_SCREEN_SOURCES: "desktop:get-screen-sources",
  /** Clear the Chromium HTTP/disk cache (safe — no logout). */
  CLEAR_CACHE: "desktop:clear-cache",
  /** Clear selected Chromium storage types (cookies = logout). */
  CLEAR_STORAGE: "desktop:clear-storage",
  /** НОВОЕ: стабильный ID устройства (SHA-256-хэш MAC-адресов) для блокировок по устройству. */
  GET_DEVICE_ID: "desktop:get-device-id",
  /** FIX-REPLAY: записать файл мгновенного повтора в настроенную папку. */
  REPLAY_WRITE: "desktop:replay-write",
  /** FIX-REPLAY: выбрать папку для файлов повтора через системный диалог. */
  REPLAY_CHOOSE_FOLDER: "desktop:replay-choose-folder",
  /**
   * UPD-BTN: что сейчас с обновлением. Кнопка в углу окна спрашивает об этом при
   * появлении: обновление могло скачаться до того, как страница загрузилась, и
   * иначе кнопка узнала бы о нём только после следующей проверки — через шесть
   * часов.
   */
  GET_UPDATE_STATE: "desktop:get-update-state",
  /**
   * VPN-ONECLICK: управление туннелем из окна приложения. `VPN_UP` принимает
   * готовый профиль (с приватным ключом, который не покидает устройство),
   * `VPN_DOWN` снимает туннель, `VPN_STATUS` отдаёт текущее состояние при
   * открытии окна — туннель мог быть поднят до загрузки страницы.
   */
  VPN_UP: "desktop:vpn-up",
  VPN_DOWN: "desktop:vpn-down",
  VPN_STATUS: "desktop:vpn-status",
  // renderer → main (send)
  SET_BADGE: "desktop:set-badge",
  /** NEW: немедленно пересчитать цифру непрочитанного на значке приложения. */
  REFRESH_BADGE: "desktop:refresh-badge",
  FOCUS_WINDOW: "desktop:focus-window",
  /**
   * FIX-NAV1: renderer просит оболочку выполнить МЯГКУЮ навигацию (без
   * перезагрузки). Полный reload (loadURL / location.assign) размонтирует
   * корневое React-дерево вместе с VoiceProvider и роняет активный голосовой
   * канал; вместо этого main пересылает путь обратно через {@link IPC.NAVIGATE},
   * а веб-приложение переключает раздел на месте, сохраняя звонок.
   */
  NAVIGATE_REQUEST: "desktop:navigate-request",
  /** НОВОЕ: PiP-режим демонстрации экрана — мини-окно поверх всех окон ОС. */
  SET_PIP: "desktop:set-pip",
  /** Renderer сообщает, что демонстрация сейчас открыта и её можно свернуть в PiP. */
  SET_SCREEN_SHARE_ACTIVE: "desktop:set-screen-share-active",
  /** FIX-OVL: renderer передаёт состояние голосового чата для оверлея. */
  VOICE_OVERLAY_STATE: "desktop:voice-overlay-state",
  /** UPD-BTN: поставить скачанное обновление (нажата кнопка в углу окна). */
  INSTALL_UPDATE: "desktop:install-update",
  /** FIX-OVL: действие из окна оверлея (open-app / close). */
  OVERLAY_ACTION: "desktop:overlay-action",
  /** FIX-OVL-SIZE: окно оверлея сообщает фактическую высоту контента. */
  OVERLAY_RESIZE: "desktop:overlay-resize",
  /**
   * FIX-OVL-DRAG2: перетаскивание окна оверлея мышью. Штатный -webkit-app-region
   * здесь не годится (см. main/overlay.ts), поэтому окно двигает main-процесс
   * по экранным координатам курсора.
   */
  OVERLAY_MOVE_START: "desktop:overlay-move-start",
  OVERLAY_MOVE: "desktop:overlay-move",
  OVERLAY_MOVE_END: "desktop:overlay-move-end",
  // main → renderer (push)
  TOGGLE_MUTE: "desktop:toggle-mute",
  PUSH_TO_TALK: "desktop:push-to-talk",
  /** FIX-REPLAY: глобальный бинд «сохранить повтор» нажат. */
  SAVE_REPLAY: "desktop:save-replay",
  DEEP_LINK: "desktop:deep-link",
  NAVIGATE: "desktop:navigate",
  /** Main сообщает renderer, что системная кнопка «свернуть» включила PiP. */
  PIP_MODE_CHANGED: "desktop:pip-mode-changed",
  /**
   * Уведомление или личное сообщение из живого соединения оболочки.
   *
   * Показывает его система (нативный тост) — своей плашки у оболочки больше
   * нет. Канал остаётся: веб-часть может подписаться и показать всплывающую
   * подсказку внутри страницы.
   */
  NOTIFICATION: "desktop:notification",
  /** FIX-OVL: main → окно оверлея: актуальное состояние голосового чата. */
  OVERLAY_STATE: "desktop:overlay-state",
  /** FIX-ACT: main → renderer: обнаруженная активность пользователя на ПК (строка или null). */
  ACTIVITY_CHANGED: "desktop:activity-changed",
  /** UPD-BTN: main → renderer: обновление скачивается или готово к установке. */
  UPDATE_STATE: "desktop:update-state",
  /** VPN-ONECLICK: main → renderer: состояние туннеля изменилось. */
  VPN_STATE: "desktop:vpn-state",
} as const;
