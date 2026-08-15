import { app, session, BrowserWindow, Menu } from "electron";
import { getConfig } from "./config";
import { createMainWindow, getMainWindow, setQuitting } from "./mainWindow";
import { createTray, destroyTray } from "./tray";
import { setupScreenShare } from "./screenShare";
import { registerShortcuts, unregisterShortcuts } from "./shortcuts";
import { startBadgePolling, stopBadgePolling } from "./badge";
import { refreshNotificationBridge, stopNotificationBridge } from "./notificationBridge";
import { initAutoUpdate } from "./updater";
import { applyAutoLaunch } from "./autoLaunch";
import { registerIpc } from "./ipc";
import { invalidateCacheOnVersionChange, stopCacheMaintenance } from "./recovery"; // FIX-BLANK
import { registerMediaCacheScheme, installMediaCache } from "./mediaCache"; // FIX-CLIENTMEDIA
import { syncOverlay, destroyOverlay } from "./overlay"; // FIX-OVL
import { startActivityWatcher, stopActivityWatcher, resendActivity } from "./activity"; // FIX-ACT
import {
  registerProtocol,
  handleDeepLink,
  flushPendingDeepLink,
  deepLinkFromArgv,
} from "./deepLinks";

// The installed desktop client must start the mic -> AudioWorklet -> WebRTC
// graph even after a microphone permission prompt consumes user activation.
// This has to be set before app.whenReady().
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// FIX-CLIENTMEDIA: схему локального кеша картинок нужно объявить привилегированной
// ДО app.whenReady() — иначе Chromium посчитает её небезопасной и заблокирует
// изображения на https-странице.
registerMediaCacheScheme();

// FIX-NTF: без AppUserModelId Windows не показывает нативные тосты Electron —
// уведомления из раздела «Уведомления» молча пропадали в десктоп-версии.
// Значение совпадает с appId из electron-builder.yml, чтобы тосты корректно
// привязывались к ярлыку установленного приложения.
if (process.platform === "win32") {
  app.setAppUserModelId("ru.trioz.connect.desktop");
}

// ── Single-instance lock ────────────────────────────────────────────
// A second launch (e.g. clicking a trioz:// link) must forward to the running
// instance rather than starting a new one.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const link = deepLinkFromArgv(argv);
    if (link) handleDeepLink(link);
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  registerProtocol();

  // macOS delivers deep links through this event.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.whenReady().then(onReady);
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
function installApplicationMenu(): void {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: "appMenu" },
    { role: "editMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function onReady(): void {
  const config = getConfig();

  // FIX-BLANK: клиент обновился (electron-updater) → сборка веб-части почти
  // наверняка сменилась, а Next.js на каждую сборку выпускает новые имена
  // чанков. Сбрасываем HTTP-кеш до создания окна, иначе закешированный HTML
  // прошлой сборки запросит удалённые /_next/static/* и мы получим пустой
  // (тёмный) экран. Cookie не трогаем — сессия сохраняется.
  void invalidateCacheOnVersionChange();

  // FIX-CLIENTMEDIA: аватары, иконки сообществ и фоны отдаются с локального
  // диска — сервер их больше не пережимает и не отдаёт повторно. Ставим до
  // создания окна, чтобы перехват работал с самого первого рендера.
  try {
    installMediaCache(new URL(config.appUrl).origin);
  } catch (err) {
    console.warn("[media-cache] не удалось включить локальный кеш изображений:", err);
  }

  installApplicationMenu();

  registerIpc();
  setupScreenShare();

  const win = createMainWindow();
  // FIX-OVL: оверлей появляется/исчезает вслед за состоянием главного окна.
  // Каст обходит излишне строгие overload'ы типов BrowserWindow.on в Electron.
  const onWindowEvent = win.on.bind(win) as (event: string, listener: () => void) => void;
  for (const evt of ["minimize", "restore", "show", "hide", "focus", "blur"]) {
    onWindowEvent(evt, () => syncOverlay());
  }
  createTray();
  registerShortcuts();
  startBadgePolling();
  startActivityWatcher(); // FIX-ACT: сканирование процессов для статуса-активности
  applyAutoLaunch(config.autoLaunch);
  initAutoUpdate();

  // Bring up the notification socket once the frontend has loaded (and thus the
  // session cookie is available), and again whenever the session changes.
  win.webContents.on("did-finish-load", () => {
    void refreshNotificationBridge();
    resendActivity(); // FIX-ACT: страница перезагрузилась — повторяем текущую активность
  });
  win.webContents.on("did-navigate", () => void refreshNotificationBridge());

  session.defaultSession.cookies.on("changed", (_e, cookie) => {
    if (cookie.name.includes("next-auth.session-token")) void refreshNotificationBridge();
  });

  // A deep link may have arrived during startup (Windows initial argv / macOS).
  const initialLink = deepLinkFromArgv(process.argv);
  if (initialLink) handleDeepLink(initialLink);
  flushPendingDeepLink();

  app.on("activate", () => {
    // macOS: re-create the window when the dock icon is clicked and none exist.
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else getMainWindow()?.show();
  });
}

// When every window is truly closed (tray disabled), quit — except on macOS
// where apps conventionally stay alive.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  setQuitting(true);
  stopCacheMaintenance(); // FIX-BLANK2
  destroyOverlay(); // FIX-OVL
  unregisterShortcuts();
  stopBadgePolling();
  stopActivityWatcher(); // FIX-ACT
  stopNotificationBridge();
  destroyTray();
});
