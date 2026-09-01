/**
 * WASAPI-SS: управление нативным захватом звука из main-процесса.
 *
 * Загружает предсобранный .node-аддон. Если он недоступен (не-Windows, старый Windows,
 * нет сборки) — все вызовы безопасно возвращают ошибку через IPC, и рендерер
 * передаёт видео без звука.
 */

import { ipcMain, WebContents } from "electron";
import path from "path";
import { IPC } from "../shared/constants";

type WasapiAddon = {
  start(
    excludePid: number,
    onChunk: (data: Float32Array) => void,
    onReady: (sampleRate: number, channels: number) => void,
    onError: (msg: string) => void,
  ): void;
  stop(): void;
};

let addon: WasapiAddon | null = null;
let activeContents: WebContents | null = null;

/** Пытаемся загрузить нативный аддон один раз. */
function tryLoadAddon(): WasapiAddon | null {
  if (addon !== null) return addon;
  if (process.platform !== "win32") return null;
  try {
    // Предсобранный .node лежит рядом с скомпилированным main/index.js.
    // electron-builder копирует .node из build/Release в resources/app/
    const candidates = [
      path.join(__dirname, "wasapi_capture.node"),
      path.join(__dirname, "..", "wasapi_capture.node"),
      path.join(process.resourcesPath ?? "", "app", "wasapi_capture.node"),
    ];
    for (const p of candidates) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        addon = require(p) as WasapiAddon;
        console.log("[wasapi] addon loaded:", p);
        return addon;
      } catch {
        /* try next path */
      }
    }
    console.warn("[wasapi] native addon not found — no screen-share audio");
    return null;
  } catch (err) {
    console.warn("[wasapi] failed to load addon:", err);
    return null;
  }
}

/**
 * Регистрирует IPC-обработчики WASAPI.
 * Вызывается из setupScreenShare() или registerIpc().
 */
export function registerWasapiIpc(): void {
  // Рендерер просит запустить захват.
  ipcMain.handle(IPC.WASAPI_START, (event) => {
    const ad = tryLoadAddon();
    if (!ad) {
      // Аддон недоступен — сразу сообщаем рендереру об ошибке.
      event.sender.send(IPC.WASAPI_ERROR, "native addon unavailable");
      return;
    }
    // Останавливаем предыдущий захват (если есть).
    try { ad.stop(); } catch { /* ignore */ }
    activeContents = event.sender;

    // Исключаем весь процесс-дерево аппликации (main PID + все дочерние:
    // GPU, renderer). Рендереры воспроизводят звук собеседников — они
    // исключаются. PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE
    // автоматически охватывает всё дерево от указанного PID.
    const excludePid = process.pid;

    ad.start(
      excludePid,
      (data: Float32Array) => {
        if (!activeContents || activeContents.isDestroyed()) return;
        // Передаём буфер как transferable (zero-copy).
        activeContents.send(IPC.WASAPI_CHUNK, data.buffer);
      },
      (sampleRate: number, channels: number) => {
        if (!activeContents || activeContents.isDestroyed()) return;
        activeContents.send(IPC.WASAPI_READY, { sampleRate, channels });
      },
      (msg: string) => {
        if (!activeContents || activeContents.isDestroyed()) return;
        activeContents.send(IPC.WASAPI_ERROR, msg);
        activeContents = null;
      },
    );
  });

  ipcMain.on(IPC.WASAPI_STOP, () => {
    activeContents = null;
    try { addon?.stop(); } catch { /* ignore */ }
  });
}
