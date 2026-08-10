import { globalShortcut } from "electron";
import { getConfig } from "./config";
import { getMainWindow } from "./mainWindow";
import { IPC } from "../shared/constants";

/**
 * Global (system-wide) hotkeys. `globalShortcut` fires on key *press* only, so
 * it maps naturally onto a mute *toggle*. True hold-to-talk (separate keydown
 * and keyup) needs an OS-level key hook and is therefore implemented on the
 * renderer side when the window is focused; the push-to-talk accelerator here
 * emits a single transmit pulse that the web app can act on.
 */
function send(channel: string): void {
  getMainWindow()?.webContents.send(channel);
}

export function registerShortcuts(): void {
  globalShortcut.unregisterAll();
  const { toggleMuteShortcut, pushToTalkShortcut, replayShortcut } = getConfig();

  if (toggleMuteShortcut) {
    const ok = globalShortcut.register(toggleMuteShortcut, () => send(IPC.TOGGLE_MUTE));
    if (!ok) console.warn("[shortcuts] failed to register mute toggle:", toggleMuteShortcut);
  }

  if (pushToTalkShortcut && pushToTalkShortcut !== toggleMuteShortcut) {
    const ok = globalShortcut.register(pushToTalkShortcut, () => send(IPC.PUSH_TO_TALK));
    if (!ok) console.warn("[shortcuts] failed to register push-to-talk:", pushToTalkShortcut);
  }

  // FIX-REPLAY: глобальный бинд «сохранить мгновенный повтор» — работает даже
  // когда окно свёрнуто; renderer сам решит, есть ли активный буфер.
  if (replayShortcut && replayShortcut !== toggleMuteShortcut && replayShortcut !== pushToTalkShortcut) {
    const ok = globalShortcut.register(replayShortcut, () => send(IPC.SAVE_REPLAY));
    if (!ok) console.warn("[shortcuts] failed to register replay:", replayShortcut);
  }
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
}
