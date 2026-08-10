import { app } from "electron";
import { getConfig } from "./config";
import { getCookieHeader, hasSession } from "./session";
import { getMainWindow } from "./mainWindow";

/**
 * Unread badge management.
 *
 * The server exposes an authoritative per-channel unread count via
 * `/api/channels/unread`, which we poll. Direct-message unread counts are *not*
 * exposed by any REST endpoint, so we track them live from `dm-message` socket
 * events (see notificationBridge) and reset them when the window regains focus
 * — a good-enough heuristic for a badge.
 *
 * If the web frontend ever pushes an exact count through the
 * `window.triozDesktop.setBadgeCount()` bridge, we treat that as authoritative
 * and stop polling.
 */
const POLL_INTERVAL = 30_000;

let dmUnread = 0;
let rendererDriven = false;
let timer: NodeJS.Timeout | null = null;
let listener: ((total: number) => void) | null = null;

export function setBadgeListener(cb: (total: number) => void): void {
  listener = cb;
}

function applyBadge(total: number): void {
  const value = Math.max(0, Math.floor(total));
  app.setBadgeCount(value); // macOS dock + Linux Unity launcher
  const win = getMainWindow();
  // On Windows a numeric taskbar badge needs an overlay image; the flash is a
  // lightweight, dependency-free way to signal new activity.
  if (process.platform === "win32" && win) {
    if (value > 0 && !win.isFocused()) {
      win.flashFrame(true);
    } else if (value === 0) {
      // FIX-N4: непрочитанных больше нет — гасим подсветку таскбара.
      win.flashFrame(false);
    }
  }
  listener?.(value);
}

/** Re-poll channel unread counts and update the badge. */
export async function refreshBadge(): Promise<void> {
  if (rendererDriven) return;
  const { appUrl } = getConfig();
  if (!(await hasSession(appUrl))) {
    applyBadge(0);
    return;
  }
  try {
    const cookie = await getCookieHeader(appUrl);
    const res = await fetch(new URL("/api/channels/unread", appUrl).toString(), {
      headers: { Cookie: cookie },
    });
    if (!res.ok) return;
    const data = (await res.json()) as { unread?: Record<string, number> };
    const channelUnread = Object.values(data.unread ?? {}).reduce((a, b) => a + (b || 0), 0);
    applyBadge(channelUnread + dmUnread);
  } catch {
    // Network hiccup — keep the previous badge value.
  }
}

/** Called from the notification bridge when a DM from another user arrives. */
export function bumpDmUnread(): void {
  if (rendererDriven) return;
  dmUnread += 1;
  void refreshBadge();
}

/** Called when the window regains focus — the user is now reading. */
export function resetDmUnread(): void {
  dmUnread = 0;
  const win = getMainWindow();
  win?.flashFrame(false);
  void refreshBadge();
}

/** Authoritative count pushed by the web frontend via the preload bridge. */
export function setBadgeFromRenderer(count: number): void {
  rendererDriven = true;
  applyBadge(count);
}

export function startBadgePolling(): void {
  if (timer) return;
  void refreshBadge();
  timer = setInterval(() => void refreshBadge(), POLL_INTERVAL);

  const win = getMainWindow();
  win?.on("focus", resetDmUnread);
}

export function stopBadgePolling(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
