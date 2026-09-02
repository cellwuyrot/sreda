"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshNotificationBridge = refreshNotificationBridge;
exports.stopNotificationBridge = stopNotificationBridge;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const socket_io_client_1 = require("socket.io-client");
const shared_1 = require("@trioz/shared");
const constants_1 = require("../shared/constants");
const config_1 = require("./config");
const session_1 = require("./session");
const mainWindow_1 = require("./mainWindow");
const badge_1 = require("./badge");
let socket = null;
let currentUserId = null;
let connectedOrigin = null;
// FIX-NTF3: порядковый номер вызова refreshNotificationBridge. Функция async и
// вызывается одновременно при старте приложения и при навигации: оба вызова
// успевали пройти проверку `socket?.connected` ДО создания сокета и каждый
// создавал СВОЙ сокет — второй перезаписывал переменную, а первый оставался
// жить со своими слушателями. Итог: каждое уведомление приходило в страницу
// и в тосты ДВАЖДЫ. Теперь до создания сокета доходит только самый свежий вызов.
let refreshSeq = 0;
const ICON = path_1.default.join(__dirname, "../../resources/icon.png");
// Багфикс: ручной реконнект с нарастающей задержкой. Встроенный реконнект
// socket.io переиспользовал старую cookie из extraHeaders — после ротации
// JWT-сессии подключение вечно падало бы с ошибкой авторизации. Каждая наша
// попытка проходит через refreshNotificationBridge и берёт СВЕЖУЮ cookie.
// VPN switches replace the active route without necessarily reporting an
// offline state. Retry quickly and cap the delay at 10s instead of leaving the
// desktop service apparently frozen for 30s.
const RECONNECT_DELAYS_MS = [500, 1500, 3000, 5000, 10000];
let reconnectAttempts = 0;
let reconnectTimer = null;
function scheduleReconnect() {
    if (reconnectTimer)
        return;
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
async function refreshNotificationBridge() {
    const seq = ++refreshSeq; // FIX-NTF3
    const { appUrl } = (0, config_1.getConfig)();
    const origin = new URL(appUrl).origin;
    if (!(await (0, session_1.hasSession)(appUrl))) {
        if (seq === refreshSeq)
            teardown();
        return;
    }
    if (seq !== refreshSeq)
        return; // FIX-NTF3: вызов устарел — работает более свежий
    // Already connected to the right place.
    if (socket?.connected && connectedOrigin === origin)
        return;
    teardown();
    connectedOrigin = origin;
    const cookie = await (0, session_1.getCookieHeader)(appUrl);
    if (!cookie)
        return;
    if (seq !== refreshSeq)
        return; // FIX-NTF3
    currentUserId = await fetchCurrentUserId(appUrl, cookie);
    if (seq !== refreshSeq)
        return; // FIX-NTF3: не создаём второй параллельный сокет
    socket = (0, socket_io_client_1.io)(origin, {
        path: shared_1.SOCKET_PATH,
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
            void (0, session_1.getCookieHeader)(appUrl).then(async (c) => {
                if (c && !currentUserId)
                    currentUserId = await fetchCurrentUserId(appUrl, c);
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
    socket.on(shared_1.SOCKET_EVENTS.NEW_NOTIFICATION, (payload) => {
        // Багфикс: ЛС приходят отдельным событием dm-message (см. ниже) — без
        // этого фильтра каждое личное сообщение давало ДВА нативных тоста и две
        // записи в странице (dm-message + уведомление типа "dm").
        if (payload.type === "dm")
            return;
        (0, badge_1.refreshBadge)();
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
        if (payload.pushEnabled === false)
            return;
        if (!shouldNotify())
            return;
        show(title, body, payload.link);
    });
    socket.on(shared_1.SOCKET_EVENTS.DM_MESSAGE, (payload) => {
        // The server echoes the message to the sender too; ignore our own.
        if (currentUserId && payload.userId === currentUserId)
            return;
        (0, badge_1.bumpDmUnread)();
        const from = payload.user?.name || payload.user?.username || "Личное сообщение";
        const body = preview(payload.content);
        // FIX-NTF3: раньше ссылка была голым "/connect" — клик открывал раздел, но
        // не вёл к диалогу. Теперь ведём прямо в чат с отправителем: страница
        // /connect разбирает deep-link ?section=dm&dm=<id> при загрузке.
        const link = `/connect?section=dm&dm=${payload.userId}`;
        pushToRenderer({ kind: "dm", title: from, body, link });
        if (payload.pushEnabled === false)
            return;
        if (!shouldNotify())
            return;
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
function pushToRenderer(entry) {
    const win = (0, mainWindow_1.getMainWindow)();
    if (!win || win.isDestroyed())
        return;
    const now = Date.now();
    const key = `${entry.kind}|${entry.title}|${entry.body}|${entry.link ?? ""}`;
    if (key === lastPushKey && now - lastPushAt < 2000)
        return;
    lastPushKey = key;
    lastPushAt = now;
    const message = { ...entry, receivedAt: now };
    win.webContents.send(constants_1.IPC.NOTIFICATION, message);
}
/** Notify only when enabled and the window is not already focused. */
function shouldNotify() {
    if (!(0, config_1.getConfig)().nativeNotifications)
        return false;
    if (!electron_1.Notification.isSupported())
        return false;
    const win = (0, mainWindow_1.getMainWindow)();
    return !win || !win.isFocused();
}
function show(title, body, link) {
    const notification = new electron_1.Notification({ title, body, icon: ICON, silent: false });
    notification.on("click", () => {
        (0, mainWindow_1.focusMainWindow)();
        if (link)
            (0, mainWindow_1.navigate)(link);
    });
    notification.show();
}
function preview(content) {
    if (!content)
        return "Новое сообщение";
    // FIX-ICONS: без эмодзи в системных уведомлениях — единый строгий стиль текста.
    if (content.startsWith("e2ee:"))
        return "Зашифрованное сообщение";
    return content.length > 120 ? content.slice(0, 117) + "…" : content;
}
/**
 * Strip the `[img]<url>[/img]` markup that admin broadcasts append to their
 * body, leaving only the human-readable text. Without this the native toast
 * surfaces the literal tag alongside the message.
 */
function cleanBody(body) {
    if (!body)
        return "";
    return body.replace(/\n?\[img\][\s\S]*?\[\/img\]/g, "").trim();
}
async function fetchCurrentUserId(appUrl, cookie) {
    try {
        const res = await fetch(new URL("/api/profile/me", appUrl).toString(), {
            headers: { Cookie: cookie },
        });
        if (!res.ok)
            return null;
        const data = (await res.json());
        return data.id ?? null;
    }
    catch {
        return null;
    }
}
function teardown() {
    if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
        socket = null;
    }
    connectedOrigin = null;
    currentUserId = null;
}
function stopNotificationBridge() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    teardown();
}
//# sourceMappingURL=notificationBridge.js.map