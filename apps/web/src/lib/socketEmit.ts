import type { Server as SocketIOServer } from "socket.io";

export function getIO(): SocketIOServer | null {
  return ((globalThis as Record<string, unknown>).__socketio as SocketIOServer) ?? null;
}

export function emitToChannel(channelId: string, event: string, data: unknown): void {
  const io = getIO();
  if (io) {
    io.to(`channel-${channelId}`).emit(event, data);
  }
}

/**
 * Событие всем, кто открыл это сообщество (комната `group-<id>`, в неё сокет
 * входит по join-group). Нужно там, где меняется общее для сообщества, а не
 * содержимое одного канала: например набор своих эмодзи.
 */
export function emitToGroup(groupId: string, event: string, data: unknown): void {
  const io = getIO();
  if (io) {
    io.to(`group-${groupId}`).emit(event, data);
  }
}

export function emitToUser(userId: string, event: string, data: unknown): void {
  const io = getIO();
  if (io) {
    io.to(`dm-${userId}`).emit(event, data);
  }
}

/**
 * Emit an event to every listed user (each on their personal `dm-<id>` room,
 * which every authenticated socket joins on connect). De-duplicates ids so a
 * user with several open tabs still receives the event once per socket.
 */
export function emitToUsers(userIds: Iterable<string>, event: string, data: unknown): void {
  const io = getIO();
  if (!io) return;
  const seen = new Set<string>();
  for (const userId of userIds) {
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    io.to(`dm-${userId}`).emit(event, data);
  }
}

/** Revoke every live realtime connection for a globally banned account. */
export function revokeAccountSession(userId: string, payload: unknown): void {
  const fn = (globalThis as Record<string, unknown>).__revokeAccountSession;
  if (typeof fn === "function") {
    (fn as (userId: string, payload: unknown) => void)(userId, payload);
  }
}

/** Remove a user from all socket/voice rooms belonging to one group. */
export function revokeGroupSession(userId: string, groupId: string, channelIds: string[], payload: unknown): void {
  const fn = (globalThis as Record<string, unknown>).__revokeGroupSession;
  if (typeof fn === "function") {
    (fn as (userId: string, groupId: string, channelIds: string[], payload: unknown) => void)(userId, groupId, channelIds, payload);
  }
}
