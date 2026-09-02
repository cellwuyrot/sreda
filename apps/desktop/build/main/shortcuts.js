"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerShortcuts = registerShortcuts;
exports.unregisterShortcuts = unregisterShortcuts;
const electron_1 = require("electron");
const config_1 = require("./config");
const mainWindow_1 = require("./mainWindow");
const constants_1 = require("../shared/constants");
/**
 * Global (system-wide) hotkeys. `globalShortcut` fires on key *press* only, so
 * it maps naturally onto a mute *toggle*. True hold-to-talk (separate keydown
 * and keyup) needs an OS-level key hook and is therefore implemented on the
 * renderer side when the window is focused; the push-to-talk accelerator here
 * emits a single transmit pulse that the web app can act on.
 */
function send(channel) {
    (0, mainWindow_1.getMainWindow)()?.webContents.send(channel);
}
function registerShortcuts() {
    electron_1.globalShortcut.unregisterAll();
    const { toggleMuteShortcut, pushToTalkShortcut, replayShortcut } = (0, config_1.getConfig)();
    if (toggleMuteShortcut) {
        const ok = electron_1.globalShortcut.register(toggleMuteShortcut, () => send(constants_1.IPC.TOGGLE_MUTE));
        if (!ok)
            console.warn("[shortcuts] failed to register mute toggle:", toggleMuteShortcut);
    }
    if (pushToTalkShortcut && pushToTalkShortcut !== toggleMuteShortcut) {
        const ok = electron_1.globalShortcut.register(pushToTalkShortcut, () => send(constants_1.IPC.PUSH_TO_TALK));
        if (!ok)
            console.warn("[shortcuts] failed to register push-to-talk:", pushToTalkShortcut);
    }
    // FIX-REPLAY: глобальный бинд «сохранить мгновенный повтор» — работает даже
    // когда окно свёрнуто; renderer сам решит, есть ли активный буфер.
    if (replayShortcut && replayShortcut !== toggleMuteShortcut && replayShortcut !== pushToTalkShortcut) {
        const ok = electron_1.globalShortcut.register(replayShortcut, () => send(constants_1.IPC.SAVE_REPLAY));
        if (!ok)
            console.warn("[shortcuts] failed to register replay:", replayShortcut);
    }
}
function unregisterShortcuts() {
    electron_1.globalShortcut.unregisterAll();
}
//# sourceMappingURL=shortcuts.js.map