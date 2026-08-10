import { Notification } from "electron";
import path from "path";
import { io, type Socket } from "socket.io-client";
import {
  SOCKET_PATH,
  SOCKET_EVENTS,
  type NotificationPayload,
  type DmMessagePayload,
} from "@trioz/shared";
import { IPC } from "../shared/constants";
import type { DesktopNotification } from "../shared/types";
import { getConfig } from "./config";
import { getCookieHeader, hasSession } from "./session";
import { getMainWindow, focusMainWindow, navigate } from "./mainWindow";
import { refreshBadge, bumpDmUnread } from "./badge";

let socket: Socket | null = null;
let currentUserId: string | null = null;
let connectedOrigin: string | null = null;

const ICON = path.join(__dirname, "../../resources/icon.png");

/**
 * (Re)establish the authenticated Socket.IO connection used to surface native
 * notifications. Safe to call repeatedly — it reconnects only when the target
 * origin changes or the socket has dropped. Called on startup and whenever the
 * frontend navigates (i.e. after the user signs in).
 */
export async function refreshNotificationBridge(): Promise<void> {
  const { appUrl } = getConfig();
  const origin = new URL(appUrl).origin;

  if (!(await hasSession(appUrl))) {
    teardown();
    return;
  }
  // Already connected to the right place.
  if (socket?.connected && connectedOrigin === origin) return;

  teardown();
  connectedOrigin = origin;

  const cookie = await getCookieHeader(appUrl);
  if (!cookie) return;

  currentUserId = await fetchCurrentUserId(appUrl, cookie);

  socket = io(origin, {
    path: SOCKET_PATH,
    transports: ["websocket"],
    withCredentials: true,
    extraHeaders: { Cookie: cookie },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
  });

  socket.on("connect", () => console.log("[notify] socket connected"));
  socket.on("connect_error", (err) => console.warn("[notify] socket error:", err.message));

  socket.on(SOCKET_EVENTS.NEW_NOTIFICATION, (payload: NotificationPayload) => {
    refreshBadge();
    const title = payload.title || "TrioZ Connect";
    // System broadcasts embed images as `[img]<url>[/img]` markup inside the
    // body; strip it so the toast/status bar show clean prose instead of the
    // raw tag (the full message is readable on /settings/notifications).
    const body = cleanBody(payload.body);
    // Always feed the in-app status bar; the native toast only fires when the
    // window is in the background (see shouldNotify).
    pushToStatusBar({ kind: "notification", title, body, link: payload.link });
    if (!shouldNotify()) return;
    show(title, body, payload.link);
  });

  socket.on(SOCKET_EVENTS.DM_MESSAGE, (payload: DmMessagePayload) => {
    // The server echoes the message to the sender too; ignore our own.
    if (currentUserId && payload.userId === currentUserId) return;
    bumpDmUnread();
    const from = payload.user?.name || payload.user?.username || "Личное сообщение";
    const body = preview(payload.content);
    pushToStatusBar({ kind: "dm", title: from, body, link: "/connect" });
    if (!shouldNotify()) return;
    show(from, body, "/connect");
  });

  // FIX-N3: канал прочитан (в этом окне или на другом устройстве) — сразу
  // пересчитываем значок на панели задач, не дожидаясь 30-секундного поллинга.
  socket.on("channel-read", () => {
    void refreshBadge();
  });
}

/**
 * Push a notification to the renderer's in-app status bar. Unlike the native
 * toast this fires regardless of focus — the status bar is meant to be a quiet,
 * always-visible log of what just came in.
 */
function pushToStatusBar(entry: Omit<DesktopNotification, "receivedAt">): void {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  const message: DesktopNotification = { ...entry, receivedAt: Date.now() };
  win.webContents.send(IPC.NOTIFICATION, message);
}

/** Notify only when enabled and the window is not already focused. */
function shouldNotify(): boolean {
  if (!getConfig().nativeNotifications) return false;
  if (!Notification.isSupported()) return false;
  const win = getMainWindow();
  return !win || !win.isFocused();
}

function show(title: string, body: string, link?: string): void {
  const notification = new Notification({ title, body, icon: ICON, silent: false });
  notification.on("click", () => {
    focusMainWindow();
    if (link) navigate(link);
  });
  notification.show();
}

function preview(content?: string): string {
  if (!content) return "Новое сообщение";
  if (content.startsWith("e2ee:")) return "🔒 Зашифрованное сообщение";
  return content.length > 120 ? content.slice(0, 117) + "…" : content;
}

/**
 * Strip the `[img]<url>[/img]` markup that admin broadcasts append to their
 * body, leaving only the human-readable text. Without this the native toast
 * and status bar surface the literal tag alongside the message.
 */
function cleanBody(body?: string): string {
  if (!body) return "";
  return body.replace(/\n?\[img\][\s\S]*?\[\/img\]/g, "").trim();
}

async function fetchCurrentUserId(appUrl: string, cookie: string): Promise<string | null> {
  try {
    const res = await fetch(new URL("/api/profile/me", appUrl).toString(), {
      headers: { Cookie: cookie },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string };
    return data.id ?? null;
  } catch {
    return null;
  }
}

function teardown(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  connectedOrigin = null;
  currentUserId = null;
}

export function stopNotificationBridge(): void {
  teardown();
}
