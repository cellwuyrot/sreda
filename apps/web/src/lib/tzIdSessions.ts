import prisma from "./prisma";
import { getIO } from "./socketEmit";

/** Legacy JWTs without a linked session fail closed once at deployment. */
export async function liveSession(
  userId: string,
  sessionId: string | null | undefined,
): Promise<boolean> {
  if (!userId || !sessionId) return false;
  const row = await prisma.userSession.findFirst({
    where: {
      id: sessionId,
      userId,
      active: true,
      expiresAt: { gt: new Date() },
    },
    include: {
      user: {
        select: {
          isDeleted: true,
          banned: true,
          bannedUntil: true,
          passwordChangedAt: true,
        },
      },
    },
  });
  if (
    !row ||
    row.user.isDeleted ||
    (row.user.banned &&
      (!row.user.bannedUntil || row.user.bannedUntil > new Date()))
  )
    return false;
  if (row.user.passwordChangedAt && row.user.passwordChangedAt > row.createdAt)
    return false;
  // Preserve the existing active-session sliding lifetime, with bounded DB writes.
  if (row.lastUsed && row.lastUsed.getTime() < Date.now() - 3600_000) {
    await prisma.userSession.updateMany({
      where: { id: row.id, userId, active: true },
      data: {
        lastUsed: new Date(),
        expiresAt: new Date(Date.now() + 2 * 86400_000),
      },
    });
  }
  return true;
}
export async function revokeSessions(
  userId: string,
  sessionId?: string,
  except?: string,
) {
  await prisma.$transaction(async (tx) => {
    const filter = {
      userId,
      ...(sessionId
        ? { id: sessionId }
        : except
          ? { id: { not: except } }
          : {}),
    };
    await tx.userSession.updateMany({ where: filter, data: { active: false } });
    await tx.tzIdAuthorization.updateMany({
      where: {
        userId,
        ...(sessionId
          ? { sessionId }
          : except
            ? { sessionId: { not: except } }
            : {}),
      },
      data: { revokedAt: new Date() },
    });
  });
  const io = getIO();
  if (io) {
    // Session state already committed; a transient Socket.IO error must not undo revocation.
    const sockets = await io.fetchSockets().catch(() => []);
    for (const socket of sockets) {
      if (
        socket.data.tzUserId === userId &&
        (!sessionId || socket.data.tzSessionId === sessionId) &&
        (!except || socket.data.tzSessionId !== except)
      )
        socket.disconnect(true);
    }
  }
}
