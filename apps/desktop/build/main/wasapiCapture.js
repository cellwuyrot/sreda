"use strict";
/**
 * WASAPI-SS: управление нативным захватом звука из main-процесса.
 *
 * Загружает предсобранный .node-аддон. Если он недоступен (не-Windows, старый Windows,
 * нет сборки) — все вызовы безопасно возвращают ошибку через IPC, и рендерер
 * передаёт видео без звука.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWasapiIpc = registerWasapiIpc;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const constants_1 = require("../shared/constants");
let addon = null;
let activeContents = null;
/** Пытаемся загрузить нативный аддон один раз. */
function tryLoadAddon() {
    if (addon !== null)
        return addon;
    if (process.platform !== "win32")
        return null;
    try {
        // Предсобранный .node лежит рядом с скомпилированным main/index.js.
        // electron-builder копирует .node из build/Release в resources/app/
        const candidates = [
            path_1.default.join(__dirname, "wasapi_capture.node"),
            path_1.default.join(__dirname, "..", "wasapi_capture.node"),
            path_1.default.join(process.resourcesPath ?? "", "app", "wasapi_capture.node"),
        ];
        for (const p of candidates) {
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                addon = require(p);
                console.log("[wasapi] addon loaded:", p);
                return addon;
            }
            catch {
                /* try next path */
            }
        }
        console.warn("[wasapi] native addon not found — no screen-share audio");
        return null;
    }
    catch (err) {
        console.warn("[wasapi] failed to load addon:", err);
        return null;
    }
}
/**
 * Регистрирует IPC-обработчики WASAPI.
 * Вызывается из setupScreenShare() или registerIpc().
 */
function registerWasapiIpc() {
    // Рендерер просит запустить захват.
    electron_1.ipcMain.handle(constants_1.IPC.WASAPI_START, (event) => {
        const ad = tryLoadAddon();
        if (!ad) {
            // Аддон недоступен — сразу сообщаем рендереру об ошибке.
            event.sender.send(constants_1.IPC.WASAPI_ERROR, "native addon unavailable");
            return;
        }
        // Останавливаем предыдущий захват (если есть).
        try {
            ad.stop();
        }
        catch { /* ignore */ }
        activeContents = event.sender;
        // Исключаем весь процесс-дерево аппликации (main PID + все дочерние:
        // GPU, renderer). Рендереры воспроизводят звук собеседников — они
        // исключаются. PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE
        // автоматически охватывает всё дерево от указанного PID.
        const excludePid = process.pid;
        ad.start(excludePid, (data) => {
            if (!activeContents || activeContents.isDestroyed())
                return;
            // Передаём буфер как transferable (zero-copy).
            activeContents.send(constants_1.IPC.WASAPI_CHUNK, data.buffer);
        }, (sampleRate, channels) => {
            if (!activeContents || activeContents.isDestroyed())
                return;
            activeContents.send(constants_1.IPC.WASAPI_READY, { sampleRate, channels });
        }, (msg) => {
            if (!activeContents || activeContents.isDestroyed())
                return;
            activeContents.send(constants_1.IPC.WASAPI_ERROR, msg);
            activeContents = null;
        });
    });
    electron_1.ipcMain.on(constants_1.IPC.WASAPI_STOP, () => {
        activeContents = null;
        try {
            addon?.stop();
        }
        catch { /* ignore */ }
    });
}
//# sourceMappingURL=wasapiCapture.js.map