"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerProtocol = registerProtocol;
exports.parseDeepLink = parseDeepLink;
exports.handleDeepLink = handleDeepLink;
exports.flushPendingDeepLink = flushPendingDeepLink;
exports.deepLinkFromArgv = deepLinkFromArgv;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const constants_1 = require("../shared/constants");
const mainWindow_1 = require("./mainWindow");
/** A deep link received before the window existed, replayed once it's ready. */
let pending = null;
/** Register `trioz://` as a protocol this app handles. */
function registerProtocol() {
    if (process.defaultApp && process.argv.length >= 2) {
        // In dev the executable is Electron itself, so the launcher must include
        // the script path for the OS to invoke us correctly.
        electron_1.app.setAsDefaultProtocolClient(constants_1.PROTOCOL, process.execPath, [path_1.default.resolve(process.argv[1])]);
    }
    else {
        electron_1.app.setAsDefaultProtocolClient(constants_1.PROTOCOL);
    }
}
/**
 * Convert a `trioz://…` URL into an in-app navigation target.
 *   trioz://invite/abc123   → { type: "invite", path: "/invite/abc123", code }
 *   trioz://connect         → { type: "connect", path: "/connect" }
 */
function parseDeepLink(rawUrl) {
    let url;
    try {
        url = new URL(rawUrl);
    }
    catch {
        return null;
    }
    if (url.protocol !== `${constants_1.PROTOCOL}:`)
        return null;
    // For `trioz://invite/abc`, host = "invite" and pathname = "/abc".
    const type = url.hostname || "";
    const rest = url.pathname.replace(/^\/+/, "");
    if (type === "invite") {
        const code = rest || url.searchParams.get("code") || "";
        if (!code)
            return null;
        return { type, path: `/invite/${encodeURIComponent(code)}`, code, raw: rawUrl };
    }
    // Generic fallback: trioz://<segment>/<rest> → /<segment>/<rest>
    const target = "/" + [type, rest].filter(Boolean).join("/");
    return { type: type || "root", path: target, raw: rawUrl };
}
/** Act on a deep link: focus the window, navigate, and inform the renderer. */
function handleDeepLink(rawUrl) {
    const payload = parseDeepLink(rawUrl);
    if (!payload)
        return;
    const win = (0, mainWindow_1.getMainWindow)();
    if (!win) {
        pending = rawUrl;
        return;
    }
    (0, mainWindow_1.focusMainWindow)();
    (0, mainWindow_1.navigate)(payload.path);
    win.webContents.send(constants_1.IPC.DEEP_LINK, payload);
}
/** Replay any deep link captured before the window existed. */
function flushPendingDeepLink() {
    if (pending) {
        const url = pending;
        pending = null;
        handleDeepLink(url);
    }
}
/** Extract a `trioz://` URL from process argv (Windows/Linux launch/relaunch). */
function deepLinkFromArgv(argv) {
    return argv.find((arg) => arg.startsWith(`${constants_1.PROTOCOL}://`)) ?? null;
}
//# sourceMappingURL=deepLinks.js.map