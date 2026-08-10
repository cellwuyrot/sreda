import prisma from "@/lib/prisma";

export type ActiveTimeout = {
  mutedUntil: Date;
  muteReason: string | null;
};

/**
 * Возвращает активный тайм-аут пользователя в группе, которой принадлежит канал,
 * или null, если ограничений нет.
 *
 * Использование в POST /api/messages (см. PATCHES.md):
 *   const timeout = await getActiveTimeout(session.user.id, channelId);
 *   if (timeout) {
 *     return NextResponse.json(
 *       { error: "Вы временно ограничены в отправке сообщений", mutedUntil: timeout.mutedUntil },
 *       { status: 403 },
 *     );
 *   }
 */
export async function getActiveTimeout(
  userId: string,
  channelId: string,
): Promise<ActiveTimeout | null> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { groupId: true },
  });
  if (!channel) return null;

  const member = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId: channel.groupId } },
    select: { mutedUntil: true, muteReason: true },
  });

  if (member?.mutedUntil && new Date(member.mutedUntil) > new Date()) {
    return { mutedUntil: member.mutedUntil, muteReason: member.muteReason ?? null };
  }
  return null;
}
