/**
 * Shared Socket.IO contract between the TrioZ web server
 * (apps/web/server.ts) and every client — the browser frontend and the
 * Electron desktop shell (apps/desktop).
 *
 * Before the monorepo, the transport path and event names were copied by hand
 * into both repositories, so a change in one place silently broke the other.
 * Keeping them here removes that whole class of "typo in a string literal"
 * bugs: the web server, the browser and the desktop shell now all import the
 * exact same constants.
 */

/** Socket.IO endpoint mounted by the custom Next.js server (see apps/web/server.ts). */
export const SOCKET_PATH = "/api/socketio";

/**
 * Server → client events delivered to a user's personal `dm-<userId>` room,
 * which every authenticated socket joins automatically. The desktop shell
 * subscribes to these to raise native OS notifications; the web frontend uses
 * them to bump unread counters and render toasts.
 */
export const SOCKET_EVENTS = {
  /** A new in-app notification (mention, friend request, task update, …). */
  NEW_NOTIFICATION: "new-notification",
  /** A direct message addressed to the current user. */
  DM_MESSAGE: "dm-message",
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

/** Payload emitted alongside {@link SOCKET_EVENTS.NEW_NOTIFICATION}. */
export interface NotificationPayload {
  title?: string;
  body?: string;
  link?: string;
  type?: string;
  /**
   * false — получатель выключил push-уведомления: запись в журнале остаётся,
   * но нативный тост показывать не нужно.
   */
  pushEnabled?: boolean;
  [key: string]: unknown;
}

/** Payload emitted alongside {@link SOCKET_EVENTS.DM_MESSAGE}. */
export interface DmMessagePayload {
  userId: string;
  content?: string;
  user?: { id: string; name?: string; username?: string };
  conversationId?: string;
  /** false — получатель выключил push-уведомления: нативный тост не нужен. */
  pushEnabled?: boolean;
  [key: string]: unknown;
}
