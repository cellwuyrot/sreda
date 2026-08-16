import { ipcMain, app, session, dialog } from "electron";
import { createHash } from "crypto";
import { join } from "path"; // FIX-REPLAY
import { promises as fsp } from "fs"; // FIX-REPLAY
import { IPC } from "../shared/constants";
import type { DesktopConfig, DesktopInfo } from "../shared/types";
import { getConfig, updateConfig } from "./config";
import { focusMainWindow, getMainWindow, setPipMode, setScreenShareActive, navigate } from "./mainWindow";
import { refreshBadge, setBadgeFromRenderer } from "./badge";
import { registerShortcuts } from "./shortcuts";
import { applyAutoLaunch } from "./autoLaunch";
import { refreshNotificationBridge } from "./notificationBridge";
import {
  updateVoiceOverlayState,
  handleOverlayAction,
  handleOverlayResize,
  handleOverlayMoveStart,
  handleOverlayMove,
  handleOverlayMoveEnd,
  syncOverlay,
} from "./overlay"; // FIX-OVL
import { currentUpdateState, installDownloadedUpdate } from "./updater"; // UPD-BTN
import type { VoiceOverlayState } from "../shared/types";

/** Register every IPC endpoint the preload bridge relies on. */
export function registerIpc(): void {
  ipcMain.handle(IPC.GET_INFO, (): DesktopInfo => {
    const { appUrl } = getConfig();
    return {
      isDesktop: true,
      version: app.getVersion(),
      platform: process.platform,
      appUrl,
    };
  });

  ipcMain.handle(IPC.GET_CONFIG, (): DesktopConfig => getConfig());

  /* UPD-BTN: кнопка в углу окна спрашивает состояние при появлении — обновление
     могло скачаться до того, как страница загрузилась. */
  ipcMain.handle(IPC.GET_UPDATE_STATE, () => currentUpdateState());

  ipcMain.on(IPC.INSTALL_UPDATE, () => {
    installDownloadedUpdate();
  });

  ipcMain.handle(IPC.SET_CONFIG, (_e, patch: Partial<DesktopConfig>): DesktopConfig => {
    const previous = getConfig();
    const next = updateConfig(patch ?? {});

    if (
      next.toggleMuteShortcut !== previous.toggleMuteShortcut ||
      next.pushToTalkShortcut !== previous.pushToTalkShortcut ||
      next.replayShortcut !== previous.replayShortcut // FIX-REPLAY
    ) {
      registerShortcuts();
    }
    if (next.autoLaunch !== previous.autoLaunch) {
      applyAutoLaunch(next.autoLaunch);
    }
    if (next.appUrl !== previous.appUrl) {
      getMainWindow()?.loadURL(next.appUrl).catch(() => undefined);
      void refreshNotificationBridge();
    }
    // FIX-OVL: изменились настройки оверлея — пересчитать его видимость/позицию.
    if (
      next.overlayEnabled !== previous.overlayEnabled ||
      next.overlaySide !== previous.overlaySide ||
      next.overlayShowScreen !== previous.overlayShowScreen
    ) {
      syncOverlay();
    }
    return next;
  });

  // ── Очистка HTTP-кеша (безопасно, без выхода из аккаунта) ──────────
  // session.clearCache() сбрасывает дисковый кеш Chromium: изображения,
  // шрифты, скрипты, стили — всё то, что браузер хранит для ускорения
  // повторных загрузок. Куки и localStorage при этом не затрагиваются.
  ipcMain.handle(IPC.CLEAR_CACHE, async (): Promise<void> => {
    await session.defaultSession.clearCache();
  });

  // ── Глубокий сброс хранилища (указанные типы) ──────────────────────
  // clearStorageData позволяет точечно выбрать, что именно удалить.
  // При передаче "cookies" пользователь будет разлогинен.
  ipcMain.handle(
    IPC.CLEAR_STORAGE,
    async (_e, storages: string[]): Promise<void> => {
      await session.defaultSession.clearStorageData({
  storages: storages as ("cookies"|"filesystem"|"indexdb"|"localstorage"|"shadercache"|"websql"|"serviceworkers"|"cachestorage")[],
});
    },
  );

  ipcMain.on(IPC.SET_BADGE, (_e, count: number) => {
    if (typeof count === "number" && Number.isFinite(count)) setBadgeFromRenderer(count);
  });

  // Веб-приложение только что пометило сообщения прочитанными — переопрашиваем
  // непрочитанные каналы, не дожидаясь 30-секундного поллинга. Багфикс: раньше
  // здесь вызывался resetDmUnread(), и прочтение ОБЫЧНОГО канала гасило счётчик
  // непрочитанных ЛС. Счётчик ЛС теперь сбрасывается только при фокусе окна
  // (см. badge.ts — startBadgePolling).
  ipcMain.on(IPC.REFRESH_BADGE, () => void refreshBadge());

  // НОВОЕ: стабильный ID устройства — SHA-256-хэш MAC-адресов внешних сетевых
  // интерфейсов. Веб-приложение передаёт его на сервер, чтобы при глобальном
  // бане учётная запись останавливалась по IP и MAC-адресу.
  ipcMain.handle(IPC.GET_DEVICE_ID, (): string => computeDeviceId());

  ipcMain.on(IPC.FOCUS_WINDOW, () => focusMainWindow());

  // FIX-NAV1: мягкая навигация по запросу renderer (клик по нижней плашке
  // статус-бара и т.п.). navigate() сам решает: переслать путь в SPA через
  // IPC.NAVIGATE (без перезагрузки — голосовой канал не рвётся) или, если
  // приложение ещё не загружено, выполнить полную загрузку как запасной путь.
  ipcMain.on(IPC.NAVIGATE_REQUEST, (_e, path: unknown) => {
    if (typeof path === "string" && path.trim()) navigate(path);
  });

  // НОВОЕ: PiP-режим демонстрации экрана — «свернуть до мини-окна» превращает
  // окно приложения в маленькое окно поверх всех окон ОС (и обратно).
  ipcMain.on(IPC.SET_PIP, (_e, enabled: boolean) => setPipMode(enabled === true));
  ipcMain.on(IPC.SET_SCREEN_SHARE_ACTIVE, (_e, active: boolean) => setScreenShareActive(active === true));
  // FIX-OVL: состояние голосового чата для оверлея + действия из окна оверлея.
  ipcMain.on(IPC.VOICE_OVERLAY_STATE, (_e, state: VoiceOverlayState | null) => updateVoiceOverlayState(state ?? null));
  ipcMain.on(IPC.OVERLAY_ACTION, (_e, action: string) => handleOverlayAction(String(action)));
  // FIX-OVL-SIZE: авто-высота окна оверлея по фактическому контенту.
  ipcMain.on(IPC.OVERLAY_RESIZE, (_e, height: number) => handleOverlayResize(Number(height)));
  // FIX-OVL-DRAG2: перетаскивание окна оверлея мышью.
  ipcMain.on(IPC.OVERLAY_MOVE_START, (_e, point: { x?: number; y?: number } | null) =>
    handleOverlayMoveStart(Number(point?.x), Number(point?.y)),
  );
  ipcMain.on(IPC.OVERLAY_MOVE, (_e, point: { x?: number; y?: number } | null) =>
    handleOverlayMove(Number(point?.x), Number(point?.y)),
  );
  ipcMain.on(IPC.OVERLAY_MOVE_END, () => handleOverlayMoveEnd());

  // FIX-REPLAY: записать файл мгновенного повтора в настроенную папку.
  // Данные приходят из renderer уже готовым контейнером (WebM); main-процесс
  // только кладёт байты на диск — никакой сети и сервера.
  ipcMain.handle(IPC.REPLAY_WRITE, async (_e, data: ArrayBuffer, ext: string): Promise<string | null> => {
    try {
      const cfg = getConfig();
      const dir = cfg.replayFolder || join(app.getPath("videos"), "TrioZ Replays");
      await fsp.mkdir(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
      const safeExt = /^[a-z0-9]{1,5}$/i.test(ext) ? ext.toLowerCase() : "webm";
      const file = join(dir, `TrioZ Replay ${stamp}.${safeExt}`);
      await fsp.writeFile(file, Buffer.from(new Uint8Array(data)));
      return file;
    } catch (err) {
      console.warn("[replay] failed to write file:", err);
      return null;
    }
  });

  // FIX-REPLAY: системный диалог выбора папки для повторов; выбор сохраняется в конфиге.
  ipcMain.handle(IPC.REPLAY_CHOOSE_FOLDER, async (): Promise<string | null> => {
    const win = getMainWindow();
    const opts = {
      title: "Папка для сохранения повторов",
      properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths.length) return null;
    updateConfig({ replayFolder: res.filePaths[0] });
    return res.filePaths[0];
  });
}

/**
 * Stable application-profile ID. Never derive identity from network adapters:
 * VPN clients add/remove virtual MAC addresses and used to change this value,
 * which made the server treat one installation as a different device.
 */
function computeDeviceId(): string {
  const basis = `${process.platform}:${app.getPath("userData")}:trioz-device-v2`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}
