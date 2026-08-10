import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/constants";
import type { VoiceOverlayState } from "../shared/types";

/**
 * FIX-OVL: мост для окна оверлея голосового чата.
 * Окно оверлея — маленькая статическая HTML-страница (static/overlay), ей
 * нужно только получать состояние и отправлять действия обратно в main.
 */
contextBridge.exposeInMainWorld("triozOverlay", {
  onState(cb: (state: VoiceOverlayState | null) => void): () => void {
    const listener = (_e: unknown, state: VoiceOverlayState | null) => cb(state);
    ipcRenderer.on(IPC.OVERLAY_STATE, listener);
    return () => {
      ipcRenderer.removeListener(IPC.OVERLAY_STATE, listener);
    };
  },
  action(name: string): void {
    ipcRenderer.send(IPC.OVERLAY_ACTION, name);
  },
  /** FIX-OVL-SIZE: сообщить main-процессу фактическую высоту контента (px). */
  resize(height: number): void {
    ipcRenderer.send(IPC.OVERLAY_RESIZE, height);
  },
});
