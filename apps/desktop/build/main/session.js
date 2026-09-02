"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCookieHeader = getCookieHeader;
exports.hasSession = hasSession;
const electron_1 = require("electron");
/**
 * Read all cookies Electron holds for the given origin and serialize them into
 * a single `Cookie:` header value.
 *
 * The desktop shell never handles passwords itself — the user signs in through
 * the normal NextAuth web flow inside the BrowserWindow, and Electron persists
 * the resulting JWT session cookie in its default (disk-backed) session
 * partition. We reuse that exact cookie to authenticate the main-process
 * Socket.IO client, so there is a single source of truth for the session.
 */
async function getCookieHeader(appUrl) {
    try {
        const url = new URL(appUrl);
        const cookies = await electron_1.session.defaultSession.cookies.get({ url: url.origin });
        return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    }
    catch {
        return "";
    }
}
/**
 * True when a NextAuth session cookie is present for the origin. Used to decide
 * whether it is worth opening the notification socket yet.
 */
async function hasSession(appUrl) {
    try {
        const url = new URL(appUrl);
        const cookies = await electron_1.session.defaultSession.cookies.get({ url: url.origin });
        return cookies.some((c) => c.name.includes("next-auth.session-token"));
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=session.js.map