"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const constants_1 = require("../shared/constants");
/**
 * FIX-OVL: мост для окна оверлея голосового чата.
 * Окно оверлея — маленькая статическая HTML-страница (static/overlay), ей
 * нужно только получать состояние и отправлять действия обратно в main.
 */
electron_1.contextBridge.exposeInMainWorld("triozOverlay", {
    onState(cb) {
        const listener = (_e, state) => cb(state);
        electron_1.ipcRenderer.on(constants_1.IPC.OVERLAY_STATE, listener);
        return () => {
            electron_1.ipcRenderer.removeListener(constants_1.IPC.OVERLAY_STATE, listener);
        };
    },
    action(name) {
        electron_1.ipcRenderer.send(constants_1.IPC.OVERLAY_ACTION, name);
    },
    /** FIX-OVL-SIZE: сообщить main-процессу фактическую высоту контента (px). */
    resize(height) {
        electron_1.ipcRenderer.send(constants_1.IPC.OVERLAY_RESIZE, height);
    },
    /* FIX-OVL-DRAG2: три шага перетаскивания. Координаты — экранные (screenX/screenY),
       а не оконные: окно едет вслед за курсором, и оконные считались бы от
       убегающей точки отсчёта — окно бы дёргалось и убегало. */
    moveStart(x, y) {
        electron_1.ipcRenderer.send(constants_1.IPC.OVERLAY_MOVE_START, { x, y });
    },
    moveTo(x, y) {
        electron_1.ipcRenderer.send(constants_1.IPC.OVERLAY_MOVE, { x, y });
    },
    moveEnd() {
        electron_1.ipcRenderer.send(constants_1.IPC.OVERLAY_MOVE_END);
    },
});
//# sourceMappingURL=overlay.js.map