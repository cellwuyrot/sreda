import { app, nativeImage } from "electron";
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

// FIX-NTF2: кэш готовых overlay-значков по тексту ("1".."9", "9+").
const overlayIconCache = new Map<string, Electron.NativeImage>();

// FIX-NTF2: пиксельный шрифт 3×5 для цифр на значке 16×16.
const DIGITS: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  "+": ["000", "010", "111", "010", "000"],
};

/**
 * Багфикс: app.setBadgeCount() на Windows ничего не рисует — таскбару нужен
 * overlay-значок. Генерируем красный кружок на лету (BGRA-битмап, без
 * ассетов). FIX-NTF2: теперь внутри кружка рисуется число непрочитанных
 * (1..9 или «9+»), как в Discord, а не просто красная точка.
 */
function windowsOverlayIcon(count: number): Electron.NativeImage {
  const label = count > 9 ? "9+" : String(Math.max(1, count));
  const cached = overlayIconCache.get(label);
  if (cached) return cached;

  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const r = size / 2 - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.sqrt((x - c) * (x - c) + (y - c) * (y - c));
      const a = d <= r - 0.5 ? 255 : d >= r + 0.5 ? 0 : Math.round((r + 0.5 - d) * 255);
      const i = (y * size + x) * 4;
      buf[i] = Math.round((56 * a) / 255); // B (premultiplied alpha)
      buf[i + 1] = Math.round((29 * a) / 255); // G
      buf[i + 2] = Math.round((225 * a) / 255); // R
      buf[i + 3] = a;
    }
  }

  // Белые цифры поверх кружка (центрированный пиксельный шрифт 3×5).
  const setPx = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = 255;
    buf[i + 1] = 255;
    buf[i + 2] = 255;
    buf[i + 3] = 255;
  };
  const chars = label.split("");
  const textW = chars.length * 3 + (chars.length - 1);
  const x0 = Math.round((size - textW) / 2);
  const y0 = Math.round((size - 5) / 2);
  chars.forEach((ch, ci) => {
    const glyph = DIGITS[ch];
    if (!glyph) return;
    const gx = x0 + ci * 4;
    for (let gy = 0; gy < 5; gy++) {
      for (let px = 0; px < 3; px++) {
        if (glyph[gy][px] === "1") setPx(gx + px, y0 + gy);
      }
    }
  });

  const img = nativeImage.createFromBitmap(buf, { width: size, height: size });
  overlayIconCache.set(label, img);
  return img;
}

function applyBadge(total: number): void {
  const value = Math.max(0, Math.floor(total));
  app.setBadgeCount(value); // macOS dock + Linux Unity launcher
  const win = getMainWindow();
  if (process.platform === "win32" && win && !win.isDestroyed()) {
    if (value > 0) {
      win.setOverlayIcon(windowsOverlayIcon(value), value + " непрочитанных"); // FIX-NTF2
      if (!win.isFocused()) win.flashFrame(true);
    } else {
      win.setOverlayIcon(null, "");
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
  // NEW: окно в фокусе — пользователь читает сообщение прямо сейчас,
  // поэтому цифру на значке приложения не увеличиваем.
  const win = getMainWindow();
  if (win && !win.isDestroyed() && win.isFocused()) return;
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
