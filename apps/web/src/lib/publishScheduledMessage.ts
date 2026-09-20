import prisma from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { getChannelPermissions } from "@/lib/connectPermissions";
import { getActiveTimeout } from "@/lib/moderation";
import { checkCensor, recordCensorHits } from "@/lib/censorService";
import { resolveGroupMentions } from "@/lib/serverMentions";
import { createNotification, createNotificationsBulk } from "@/lib/createNotification";
import { messageLengthError } from "@/lib/messageLimits";
import { hasPremium } from "@/lib/premium";

/**
 * Публикация наступившего scheduled message. В момент фактической отправки
 * повторно проверяются текущие права/бан/тайм-аут/лимиты/censor; mentions всегда
 * вычисляются из текста. Это не «голый prisma.message.create».
 */
export async function publishScheduledMessage(
  scheduled: { id: string; content: string; channelId: string; userId: string },
  emit: (channelId: string, message: unknown) => void,
): Promise<void> {
  const [user, channel, permission] = await Promise.all([
    prisma.user.findUnique({
      where: { id: scheduled.userId },
      select: { banned: true, bannedUntil: true, isPremium: true, role: true, name: true },
    }),
    prisma.channel.findUnique({
      where: { id: scheduled.channelId },
      select: { groupId: true, slowmode: true },
    }),
    getChannelPermissions(scheduled.userId, scheduled.channelId),
  ]);

  const banned = user?.banned && (!user.bannedUntil || user.bannedUntil > new Date());
  const content = sanitizeText(scheduled.content).trim();
  if (!user || !channel || banned || !permission?.canPost || !content) throw new Error("scheduled message is no longer allowed");
  const lengthError = messageLengthError(content, { premium: hasPremium(user) });
  if (lengthError) throw new Error(lengthError);
  if (await getActiveTimeout(scheduled.userId, scheduled.channelId)) throw new Error("author is timed out");

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: scheduled.userId, groupId: channel.groupId } },
    select: { role: true },
  });
  if (!membership) throw new Error("author left the group");
  const privileged = ["OWNER", "ADMIN", "MODERATOR"].includes(membership.role);
  const censor = privileged
    ? { matches: [], blocked: false }
    : await checkCensor(channel.groupId, content);
  if (censor.blocked) {
    await recordCensorHits({
      groupId: channel.groupId,
      userId: scheduled.userId,
      channelId: scheduled.channelId,
      matches: censor.matches,
    });
    throw new Error("scheduled message rejected by censor");
  }

  const mentions = await resolveGroupMentions(content, channel.groupId);
  const message = await prisma.message.create({
    data: {
      content,
      channelId: scheduled.channelId,
      userId: scheduled.userId,
      mentions: mentions.ids.length ? JSON.stringify(mentions.ids) : null,
    },
    include: {
      user: { select: { id: true, name: true, username: true, avatar: true, role: true, avatarGlowEnabled: true, avatarGlowColors: true, profileBanner: true, lastSeen: true } },
      reactions: { select: { id: true, emoji: true, userId: true, user: { select: { id: true, name: true } } } },
      replyTo: { select: { id: true, content: true, user: { select: { id: true, name: true } } } },
      reads: { select: { userId: true } },
      _count: { select: { threadReplies: true } },
    },
  });
  await prisma.scheduledMessage.update({ where: { id: scheduled.id }, data: { sent: true } });
  emit(scheduled.channelId, message);

  const recipients = mentions.ids.filter((id) => id !== scheduled.userId);
  if (recipients.length > 0) {
    const notification = {
      type: "mention" as const,
      body: content.slice(0, 100),
      link: `/connect?group=${channel.groupId}&channel=${scheduled.channelId}&message=${message.id}`,
      entityType: "channel",
      entityId: scheduled.channelId,
    };
    if (mentions.everyone) {
      await createNotificationsBulk({
        ...notification,
        userIds: recipients,
        title: `${message.user.name || "Пользователь"} упомянул всех`,
      });
    } else {
      await Promise.all(recipients.map((userId) => createNotification({
        ...notification,
        userId,
        title: `${message.user.name || "Пользователь"} упомянул вас`,
      })));
    }
  }
}