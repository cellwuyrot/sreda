import prisma from "@/lib/prisma";
import { hasEveryoneMention, parseMentions } from "@/lib/mentions";

export interface ResolvedGroupMentions {
  ids: string[];
  everyone: boolean;
}

/**
 * Серверный источник истины: ID выводятся только из content и только из
 * участников указанной группы. Переданный клиентом массив здесь не участвует.
 */
export async function resolveGroupMentions(content: string, groupId: string): Promise<ResolvedGroupMentions> {
  const tokens = parseMentions(content);
  const everyone = hasEveryoneMention(content);
  if (tokens.length === 0) return { ids: [], everyone: false };

  if (everyone) {
    const members = await prisma.groupMember.findMany({
      where: { groupId },
      select: { userId: true },
    });
    return { ids: members.map((member) => member.userId), everyone: true };
  }

  const names = [...new Set(tokens.filter((token) => !token.everyone).map((token) => token.normalized))];
  if (names.length === 0) return { ids: [], everyone: false };
  const members = await prisma.groupMember.findMany({
    where: {
      groupId,
      user: {
        OR: names.map((username) => ({ username: { equals: username, mode: "insensitive" as const } })),
      },
    },
    select: { userId: true },
  });
  return { ids: members.map((member) => member.userId), everyone: false };
}