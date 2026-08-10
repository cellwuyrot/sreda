import { app } from "electron";
import path from "path";
import { PROTOCOL, IPC } from "../shared/constants";
import type { DeepLinkPayload } from "../shared/types";
import { getMainWindow, focusMainWindow, navigate } from "./mainWindow";

/** A deep link received before the window existed, replayed once it's ready. */
let pending: string | null = null;

/** Register `trioz://` as a protocol this app handles. */
export function registerProtocol(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    // In dev the executable is Electron itself, so the launcher must include
    // the script path for the OS to invoke us correctly.
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
}

/**
 * Convert a `trioz://…` URL into an in-app navigation target.
 *   trioz://invite/abc123   → { type: "invite", path: "/invite/abc123", code }
 *   trioz://connect         → { type: "connect", path: "/connect" }
 */
export function parseDeepLink(rawUrl: string): DeepLinkPayload | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${PROTOCOL}:`) return null;

  // For `trioz://invite/abc`, host = "invite" and pathname = "/abc".
  const type = url.hostname || "";
  const rest = url.pathname.replace(/^\/+/, "");

  if (type === "invite") {
    const code = rest || url.searchParams.get("code") || "";
    if (!code) return null;
    return { type, path: `/invite/${encodeURIComponent(code)}`, code, raw: rawUrl };
  }

  // Generic fallback: trioz://<segment>/<rest> → /<segment>/<rest>
  const target = "/" + [type, rest].filter(Boolean).join("/");
  return { type: type || "root", path: target, raw: rawUrl };
}

/** Act on a deep link: focus the window, navigate, and inform the renderer. */
export function handleDeepLink(rawUrl: string): void {
  const payload = parseDeepLink(rawUrl);
  if (!payload) return;

  const win = getMainWindow();
  if (!win) {
    pending = rawUrl;
    return;
  }
  focusMainWindow();
  navigate(payload.path);
  win.webContents.send(IPC.DEEP_LINK, payload);
}

/** Replay any deep link captured before the window existed. */
export function flushPendingDeepLink(): void {
  if (pending) {
    const url = pending;
    pending = null;
    handleDeepLink(url);
  }
}

/** Extract a `trioz://` URL from process argv (Windows/Linux launch/relaunch). */
export function deepLinkFromArgv(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${PROTOCOL}://`)) ?? null;
}
