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

// FIX-NTF3: порядковый номер вызова refreshNotificationBridge. Функция async и
// вызывается одновременно при старте приложения и при навигации: оба вызова
// успевали пройти проверку `socket?.connected` ДО создания сокета и каждый
// создавал СВОЙ сокет — второй перезаписывал переменную, а первый оставался
// жить со своими слушателями. Итог: каждое уведомление приходило в страницу
// и в тосты ДВАЖДЫ. Теперь до создания сокета доходит только самый свежий вызов.
let refreshSeq = 0;

const ICON = path.join(__dirname, "../../resources/icon.png");

// Багфикс: ручной реконнект с нарастающей задержкой. Встроенный реконнект
// socket.io переиспользовал старую cookie из extraHeaders — после ротации
// JWT-сессии подключение вечно падало бы с ошибкой авторизации. Каждая наша
// попытка проходит через refreshNotificationBridge и берёт СВЕЖУЮ cookie.
// VPN switches replace the active route without necessarily reporting an
// offline state. Retry quickly and cap the delay at 10s instead of leaving the
// desktop service apparently frozen for 30s.
const RECONNECT_DELAYS_MS = [500, 1500, 3000, 5000, 10000];
let reconnectAttempts = 0;
let reconnectTimer: NodeJS.Timeout | null = null;

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)];
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void refreshNotificationBridge();
  }, delay);
}

/**
 * (Re)establish the authenticated Socket.IO connection used to surface native
 * notifications. Safe to call repeatedly — it reconnects only when the target
 * origin changes or the socket has dropped. Called on startup and whenever the
 * frontend navigates (i.e. after the user signs in).
 */
export async function refreshNotificationBridge(): Promise<void> {
  const seq = ++refreshSeq; // FIX-NTF3
  const { appUrl } = getConfig();
  const origin = new URL(appUrl).origin;

  if (!(await hasSession(appUrl))) {
    if (seq === refreshSeq) teardown();
    return;
  }
  if (seq !== refreshSeq) return; // FIX-NTF3: вызов устарел — работает более свежий
  // Already connected to the right place.
  if (socket?.connected && connectedOrigin === origin) return;

  teardown();
  connectedOrigin = origin;

  const cookie = await getCookieHeader(appUrl);
  if (!cookie) return;
  if (seq !== refreshSeq) return; // FIX-NTF3

  currentUserId = await fetchCurrentUserId(appUrl, cookie);
  if (seq !== refreshSeq) return; // FIX-NTF3: не создаём второй параллельный сокет

  socket = io(origin, {
    path: SOCKET_PATH,
    // Start with polling so corporate/VPN proxies that reject WebSocket still
    // reconnect; Socket.IO upgrades to WebSocket automatically when possible.
    transports: ["polling", "websocket"],
    withCredentials: true,
    extraHeaders: { Cookie: cookie },
    // Реконнект выполняется вручную (см. scheduleReconnect) со свежей cookie.
    reconnection: false,
  });

  socket.on("connect", () => {
    reconnectAttempts = 0;
    console.log("[notify] socket connected");
    // Багфикс: если /api/profile/me был недоступен при подключении, без ID
    // нельзя отфильтровать эхо собственных ЛС — пробуем получить его ещё раз.
    if (!currentUserId) {
      void getCookieHeader(appUrl).then(async (c) => {
        if (c && !currentUserId) currentUserId = await fetchCurrentUserId(appUrl, c);
      });
    }
  });
  socket.on("connect_error", (err) => {
    console.warn("[notify] socket error:", err.message);
    scheduleReconnect();
  });
  socket.on("disconnect", (reason) => {
    console.warn("[notify] socket disconnected:", reason);
    scheduleReconnect();
  });

  socket.on(SOCKET_EVENTS.NEW_NOTIFICATION, (payload: NotificationPayload) => {
    // Багфикс: ЛС приходят отдельным событием dm-message (см. ниже) — без
    // этого фильтра каждое личное сообщение давало ДВА нативных тоста и две
    // записи в странице (dm-message + уведомление типа "dm").
    if (payload.type === "dm") return;
    refreshBadge();
    const title = payload.title || "TrioZ Connect";
    // System broadcasts embed images as `[img]<url>[/img]` markup inside the
    // body; strip it so the toast shows clean prose instead of the
    // raw tag (the full message is readable on /settings/notifications).
    const body = cleanBody(payload.body);
    // Событие всегда уходит в страницу; нативный тост показывается только
    // когда окно не в фокусе (см. shouldNotify).
    pushToRenderer({ kind: "notification", title, body, link: payload.link });
    // Пользователь выключил push-уведомления: событие в страницу уходит,
    // но нативный тост не показываем.
    if (payload.pushEnabled === false) return;
    if (!shouldNotify()) return;
    show(title, body, payload.link);
  });

  socket.on(SOCKET_EVENTS.DM_MESSAGE, (payload: DmMessagePayload) => {
    // The server echoes the message to the sender too; ignore our own.
    if (currentUserId && payload.userId === currentUserId) return;
    bumpDmUnread();
    const from = payload.user?.name || payload.user?.username || "Личное сообщение";
    const body = preview(payload.content);
    // FIX-NTF3: раньше ссылка была голым "/connect" — клик открывал раздел, но
    // не вёл к диалогу. Теперь ведём прямо в чат с отправителем: страница
    // /connect разбирает deep-link ?section=dm&dm=<id> при загрузке.
    const link = `/connect?section=dm&dm=${payload.userId}`;
    pushToRenderer({ kind: "dm", title: from, body, link });
    if (payload.pushEnabled === false) return;
    if (!shouldNotify()) return;
    show(from, body, link);
  });
}

/**
 * Отправить уведомление в страницу.
 *
 * Своей плашки у оболочки больше нет — показывает уведомление система. Событие
 * всё равно уходит в страницу: веб-часть может подписаться на него и показать
 * подсказку внутри интерфейса, и делает это независимо от того, в фокусе окно
 * или нет.
 */
// FIX-NTF3: страховка от дублей — одинаковое уведомление, пришедшее почти
// одновременно (например, от двух сокетов во время гонки реконнекта), уходит
// в страницу только один раз.
let lastPushKey = "";
let lastPushAt = 0;

function pushToRenderer(entry: Omit<DesktopNotification, "receivedAt">): void {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  const now = Date.now();
  const key = `${entry.kind}|${entry.title}|${entry.body}|${entry.link ?? ""}`;
  if (key === lastPushKey && now - lastPushAt < 2000) return;
  lastPushKey = key;
  lastPushAt = now;
  const message: DesktopNotification = { ...entry, receivedAt: now };
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
  // FIX-ICONS: без эмодзи в системных уведомлениях — единый строгий стиль текста.
  if (content.startsWith("e2ee:")) return "Зашифрованное сообщение";
  return content.length > 120 ? content.slice(0, 117) + "…" : content;
}

/**
 * Strip the `[img]<url>[/img]` markup that admin broadcasts append to their
 * body, leaving only the human-readable text. Without this the native toast
 * surfaces the literal tag alongside the message.
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
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  teardown();
}
