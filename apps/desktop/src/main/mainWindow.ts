import { BrowserWindow, shell, app, nativeTheme, Notification } from "electron";
import Store from "electron-store";
import path from "path";
import { getConfig } from "./config";
import { DEFAULT_START_PATH, IPC } from "../shared/constants";
/* Правила навигации живут отдельно и покрыты тестами — см. shared/navigation. */
import {
  isBlockedInApp,
  isExternalUrl,
  isSameOriginDocument,
  safeInAppPath,
} from "../shared/navigation";
import { watchStaleAssets, watchBlankRender, markRenderHealthy, voiceCallActive } from "./recovery"; // FIX-BLANK

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

const windowStore = new Store<{ windowState: WindowState }>({
  name: "window-state",
  defaults: {
    windowState: { width: 1280, height: 800, maximized: false },
  },
});

let mainWindow: BrowserWindow | null = null;
/** When true, `close` really quits instead of hiding to the tray. */
let quitting = false;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function setQuitting(value: boolean): void {
  quitting = value;
}

/** Bring the window back to the foreground, restoring it if minimized/hidden. */
export function focusMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

// ── PiP-режим демонстрации экрана ───────────────────────────────────
// «Свернуть до мини-окна» превращает окно приложения в маленькое окно
// поверх всех окон ОС. Прежние размеры/состояние запоминаются и
// восстанавливаются при выходе из мини-режима. Перетаскивание мышью
// обеспечивает шапка мини-плеера в веб-части (-webkit-app-region: drag).
const PIP_WIDTH = 420;
const PIP_HEIGHT = 264;

interface PipSavedState {
  bounds: Electron.Rectangle;
  maximized: boolean;
  alwaysOnTop: boolean;
  minWidth: number;
  minHeight: number;
}

let pipSavedState: PipSavedState | null = null;
let screenShareActive = false;

export function setScreenShareActive(active: boolean): void {
  screenShareActive = active;
}

/** Активен ли PiP-режим (чтобы не сохранять мини-размеры как обычные). */
export function isPipMode(): boolean {
  return pipSavedState !== null;
}

export function setPipMode(enabled: boolean): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;

  if (enabled) {
    if (pipSavedState) return; // уже в мини-режиме
    const [minWidth, minHeight] = win.getMinimumSize();
    pipSavedState = {
      bounds: win.getNormalBounds(),
      maximized: win.isMaximized(),
      alwaysOnTop: win.isAlwaysOnTop(),
      minWidth,
      minHeight,
    };
    if (win.isFullScreen()) win.setFullScreen(false);
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    if (win.isMaximized()) win.unmaximize();
    // Штатный минимум окна (940x600) больше мини-окна — временно ослабляем.
    win.setMinimumSize(280, 176);
    // Правый нижний угол рабочей области текущего монитора.
    const area = getWorkArea(win);
    win.setBounds({
      x: area.x + area.width - PIP_WIDTH - 16,
      y: area.y + area.height - PIP_HEIGHT - 16,
      width: PIP_WIDTH,
      height: PIP_HEIGHT,
    });
    // "screen-saver" — максимальный уровень: поверх обычных always-on-top окон.
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.moveTop();
    win.focus();
  } else {
    if (!pipSavedState) return;
    const saved = pipSavedState;
    pipSavedState = null;
    win.setVisibleOnAllWorkspaces(false);
    win.setAlwaysOnTop(saved.alwaysOnTop);
    win.setMinimumSize(saved.minWidth, saved.minHeight);
    win.setBounds(saved.bounds);
    if (saved.maximized) win.maximize();
  }
}

function getWorkArea(win: BrowserWindow): Electron.Rectangle {
  // Модуль screen нельзя трогать до события app "ready" — берём его лениво.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { screen } = require("electron") as typeof import("electron");
  return screen.getDisplayMatching(win.getBounds()).workArea;
}

/**
 * Navigate the loaded frontend to an in-app path (deep links, notification
 * clicks, the in-app status bar).
 *
 * FIX-NAV1: prefer a SOFT, in-app navigation over a full page load. A hard
 * `loadURL()` restarts the whole renderer and unmounts the root React tree —
 * including `VoiceProvider` — which silently drops an active voice channel (the
 * user is kicked out of the call just for clicking a notification). When the
 * frontend is already loaded on the same origin we instead hand it the path via
 * {@link IPC.NAVIGATE} and let the SPA switch sections in place, so the call
 * survives. A full load is used only as a fallback: cold start, a renderer that
 * is still loading, or a different origin.
 */
export function navigate(pathname: string): void {
  const { appUrl } = getConfig();
  const safePath = safeInAppPath(pathname);
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;

  const wc = win.webContents;
  let sameOrigin = false;
  try {
    sameOrigin = new URL(wc.getURL()).origin === new URL(appUrl).origin;
  } catch {
    sameOrigin = false;
  }

  if (sameOrigin && !wc.isLoading()) {
    wc.send(IPC.NAVIGATE, safePath);
    return;
  }

  const target = new URL(safePath, appUrl).toString();
  win.loadURL(target).catch((err) => console.error("[window] navigate failed:", err));
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusMainWindow();
    return mainWindow;
  }

  const { appUrl } = getConfig();
  const state = windowStore.get("windowState");

  // Force the whole shell — including the native window frame (the caption bar
  // with the minimize / restore / close buttons) — into dark mode. Out of the
  // box Windows paints that caption bar white, which clashes with TZ.Connect's
  // dark UI; `themeSource = "dark"` makes the OS draw it in the app's near-black
  // palette and also advertises `prefers-color-scheme: dark` to the web page.
  nativeTheme.themeSource = "dark";

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: "#0b0d12",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "../../resources/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      // FIX-DOCS: встроенный просмотрщик PDF Chromium в Electron включается
      // только этим флагом. Без него любой PDF (раздел «Документы», вложения)
      // открывался пустой белой страницей.
      plugins: true,
    },
  });

  if (state.maximized) mainWindow.maximize();

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // The shell is a dedicated TZ.Connect client, so it always opens the
  // `/connect` section — never the website's landing grid.
  const startUrl = new URL(DEFAULT_START_PATH, appUrl).toString();
  const appOrigin = new URL(appUrl).origin;
  const splashFile = path.join(__dirname, "../../static/splash/index.html");

  // ── Resilient loading ──────────────────────────────────────────────
  // The shell renders a *remote* site, so every server redeploy is a short
  // window where the reverse proxy can't reach the app and answers `502 Bad
  // Gateway` (or the connection is refused outright). Without handling, the
  // user is left staring at a broken error page and has to reload by hand.
  //
  // Instead we treat any such outage as transient: fall back to the local
  // splash (a spinner, not an error) and retry with a capped backoff until the
  // server returns, then load the real page. The whole update is invisible —
  // no manual reload, and certainly no reinstall.
  const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
  let retryCount = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const loadApp = (): void => {
    mainWindow?.loadURL(startUrl).catch(() => undefined);
  };

  const scheduleReload = (reason: string): void => {
    if (retryTimer || !mainWindow || mainWindow.isDestroyed()) return;
    const delay = RETRY_DELAYS_MS[Math.min(retryCount, RETRY_DELAYS_MS.length - 1)];
    retryCount += 1;
    console.warn(`[window] ${reason} — showing splash, retrying in ${delay}ms (attempt ${retryCount})`);
    // Show the local spinner while we wait — never Electron's error page.
    mainWindow.loadFile(splashFile).catch(() => undefined);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (mainWindow && !mainWindow.isDestroyed()) loadApp();
    }, delay);
  };

  // Network-level failures (server fully down → ERR_CONNECTION_REFUSED, DNS,
  // resets, timeouts). `-3` is ERR_ABORTED, a normal superseded navigation
  // (redirect / user click), which must not trigger a retry. We also ignore
  // failures loading the local `file://` splash.
  mainWindow.webContents.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    if (validatedURL.startsWith("file://")) return;
    scheduleReload(`load failed (${errorCode} ${errorDescription})`);
  });

  // A 5xx from the reverse proxy (e.g. 502 while the app container is being
  // recreated) arrives as a *successful* navigation carrying an error body, so
  // it never fires `did-fail-load`. Catch it here via the HTTP status. A
  // healthy load (2xx/3xx) resets the backoff.
  mainWindow.webContents.on("did-navigate", (_e, url, httpResponseCode) => {
    if (!url.startsWith(appOrigin)) return;
    if (httpResponseCode >= 500) {
      scheduleReload(`server returned ${httpResponseCode}`);
    } else if (httpResponseCode > 0 && httpResponseCode < 400) {
      retryCount = 0;
      markRenderHealthy(); // FIX-BLANK: страница ответила нормально
    }
  });

  // FIX-BLANK: два сторожа против «тёмного экрана» (см. recovery.ts):
  //  • 404 на /_next/static/* — устаревший HTML из кеша ссылается на чанки,
  //    которых на сервере уже нет (после деплоя веб-части);
  //  • пустой DOM через несколько секунд после загрузки — страховка от любой
  //    другой причины несостоявшегося рендера.
  // Оба лечатся сбросом HTTP-кеша и перезагрузкой — БЕЗ удаления cookie,
  // поэтому пользователь остаётся в аккаунте.
  watchStaleAssets(mainWindow, appOrigin);
  watchBlankRender(mainWindow, appOrigin);

  // Paint a local splash immediately, then load the real /connect page. Electron
  // keeps the splash on screen until the remote page is ready to render, so the
  // old "empty" dark window is replaced by a TZ.Connect image while it loads.
  mainWindow.loadFile(splashFile).catch(() => undefined);
  mainWindow.webContents.once("did-finish-load", () => loadApp());

  // Open external links (http/https to another origin, mailto, etc.) in the
  // user's default browser rather than inside the app shell. Website-only
  // sections (`/`, `/projects`, `/pero`, `/library`) are bounced back to
  // `/connect` instead of opening.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url, appUrl)) {
      shell.openExternal(url).catch(() => undefined);
      return { action: "deny" };
    }
    if (isBlockedInApp(url, appUrl)) {
      navigate(DEFAULT_START_PATH);
      return { action: "deny" };
    }
    // FIX: ссылки на файлы-вложения (target="_blank" на /uploads/...) раньше
    // создавали пустое белое окно, которое запускало скачивание и оставалось
    // висеть. Скачиваем файл напрямую, без создания окна.
    try {
      const { pathname } = new URL(url);
      if (pathname.startsWith("/uploads/")) {
        mainWindow?.webContents.downloadURL(url);
        return { action: "deny" };
      }
    } catch { /* некорректный URL — пропускаем */ }
    return { action: "allow" };
  });

  // Same guard for top-level navigations triggered by clicks.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isExternalUrl(url, appUrl)) {
      event.preventDefault();
      shell.openExternal(url).catch(() => undefined);
      return;
    }
    if (isBlockedInApp(url, appUrl)) {
      event.preventDefault();
      navigate(DEFAULT_START_PATH);
      return;
    }
    /* Во время разговора полная загрузка страницы недопустима: она
       перезапускает рендерер и сносит дерево React вместе с VoiceProvider —
       человек вылетает из голосового канала. Такой переход приходит сюда,
       когда сервер обновился и код нужного раздела на нём уже с другим именем:
       Next.js не может догрузить чанк и уходит на полную загрузку. Раздел в
       этом случае не откроется, но разговор останется живым; после выхода из
       канала перезагрузка выполнится сама (см. recovery.ts). */
    if (voiceCallActive() && isSameOriginDocument(url, appUrl)) {
      event.preventDefault();
      console.warn(`[window] переход ${url} отклонён: идёт разговор, перезагрузка порвала бы голосовой канал`);
      notifyNavigationHeld();
    }
  });

  persistBounds(mainWindow);

  mainWindow.on("close", (event) => {
    const { minimizeToTray } = getConfig();
    // Closing the window hides it to the tray instead of quitting, unless the
    // user chose "Quit" from the tray/menu (which sets `quitting`).
    if (!quitting && minimizeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // Если во время просмотра/показа экрана пользователь нажимает системную
  // кнопку «свернуть», не прячем приложение в taskbar: переводим его в PiP и
  // просим React переключить интерфейс на компактный плеер.
  mainWindow.on("minimize" as any, (event: Electron.Event) => {
    if (!screenShareActive || isPipMode()) return;
    event.preventDefault();
    setPipMode(true);
    mainWindow?.webContents.send("desktop:pip-mode-changed", true);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    pipSavedState = null;
    screenShareActive = false;
  });

  if (process.env.TRIOZ_DEV === "1") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  return mainWindow;
}


/**
 * Объяснить, почему раздел не открылся.
 *
 * Без этого получается молчание: человек жмёт «Настройки», и ничего не
 * происходит — хуже, чем понятный отказ. Показываем системное уведомление,
 * но не чаще раза в минуту, иначе повторные попытки завалят экран.
 */
let navigationHeldNotifiedAt = 0;
function notifyNavigationHeld(): void {
  const now = Date.now();
  if (now - navigationHeldNotifiedAt < 60_000) return;
  navigationHeldNotifiedAt = now;
  if (!Notification.isSupported()) return;
  try {
    new Notification({
      title: "Раздел откроется после звонка",
      body: "Приложение обновилось на сервере: чтобы открыть этот раздел, нужно перезагрузить окно, а это прервёт голосовой канал. Выйдите из канала — и раздел откроется.",
    }).show();
  } catch { /* уведомления недоступны — молча пропускаем */ }
}

function persistBounds(win: BrowserWindow): void {
  const save = () => {
    if (!win || win.isDestroyed()) return;
    // В PiP-режиме окно намеренно крошечное — не затираем сохранённые размеры.
    if (isPipMode()) return;
    const maximized = win.isMaximized();
    const bounds = win.getNormalBounds();
    windowStore.set("windowState", {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized,
    });
  };
  win.on("resize", save);
  win.on("move", save);
  win.on("close", save);
}

app.on("second-instance", () => {
  focusMainWindow();
});
