import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const memberships = await prisma.channelMember.findMany({
    where: { userId: session.user.id },
    select: { channelId: true, lastRead: true },
  });

  if (memberships.length === 0) {
    return NextResponse.json({ unread: {} });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { username: true, name: true },
  });
  const uname = user?.username || user?.name || "";

  // Багфикс производительности: раньше на КАЖДЫЙ канал делалось 1–2 запроса
  // count (N+1); этот эндпоинт опрашивается каждые 15–30 секунд каждым
  // клиентом. Теперь — два groupBy-запроса на все каналы сразу.
  const perChannelWindow = memberships.map((m) => ({
    channelId: m.channelId,
    createdAt: { gt: m.lastRead },
  }));
  const baseWhere = {
    deleted: false,
    userId: { not: session.user.id },
    OR: perChannelWindow,
  };

  /* FIX-NEWS-UNREAD: до этого счётчик везде считал любые строки Message канала.
     Для обычного чата это верно, а для новостей — нет: там одной и той же таблицей
     лежат сами посты (threadId = null), комментарии к ним (threadId = id поста),
     черновики (draft) и отложенные публикации (publishAt в будущем). Читатель
     видел в бейдже цифру, которой в ленте не соответствовало ничего видимого.
     Поэтому новостные каналы считаются отдельным groupBy с жёстким фильтром. */
  const channelRows = await prisma.channel.findMany({
    where: { id: { in: memberships.map((m) => m.channelId) } },
    select: { id: true, groupId: true, name: true, type: true },
  });
  const newsChannelIds = new Set(
    channelRows.filter((c) => c.type === "NEWS").map((c) => c.id),
  );

  /* Заглушка: если канал или вся группа замьючены, счётчик новостей не показываем.
     Моделей ради этого не заводим — ChannelMute и GroupMember.muted уже есть и уже
     используются при рассылке анонсов в lib/newsPost.ts. */
  const [channelMutes, groupMutes] = await Promise.all([
    prisma.channelMute.findMany({
      where: { userId: session.user.id, muted: true },
      select: { channelId: true },
    }),
    prisma.groupMember.findMany({
      where: { userId: session.user.id, muted: true },
      select: { groupId: true },
    }),
  ]);
  const mutedGroupIds = new Set(groupMutes.map((g) => g.groupId));
  const mutedChannelIds = new Set<string>(channelMutes.map((c) => c.channelId));
  for (const c of channelRows) {
    if (c.groupId && mutedGroupIds.has(c.groupId)) mutedChannelIds.add(c.id);
  }

  const unreadCounts: Record<string, number> = {};
  const grouped = await prisma.message.groupBy({
    by: ["channelId"],
    where: {
      ...baseWhere,
      /* Обычные каналы считаются по-старому. */
      channelId: { notIn: [...newsChannelIds] },
    },
    _count: { _all: true },
  });
  for (const g of grouped) {
    if (g._count._all > 0) unreadCounts[g.channelId] = g._count._all;
  }

  if (newsChannelIds.size > 0) {
    const now = new Date();
    const newsWindow = memberships
      .filter((m) => newsChannelIds.has(m.channelId) && !mutedChannelIds.has(m.channelId))
      .map((m) => ({ channelId: m.channelId, createdAt: { gt: m.lastRead } }));

    if (newsWindow.length > 0) {
      const newsGrouped = await prisma.message.groupBy({
        by: ["channelId"],
        where: {
          deleted: false,
          userId: { not: session.user.id },
          OR: newsWindow,
          /* Только верхний уровень — комментарии не новости. */
          threadId: null,
          /* Черновики видны только автору и в ленте читателя не появляются. */
          draft: false,
          /* Отложенный пост становится новостью лишь после наступления publishAt.
             Окно по каналам уже заняло верхний OR, поэтому второе условие-дизъюнкция
             заворачивается в AND — иначе один OR затёр бы другой. */
          AND: [{ OR: [{ publishAt: null }, { publishAt: { lte: now } }] }],
        },
        _count: { _all: true },
      });
      for (const g of newsGrouped) {
        if (g._count._all > 0) unreadCounts[g.channelId] = g._count._all;
      }
    }
  }

  const mentionChannels: Record<string, boolean> = {};
  if (uname && grouped.length > 0) {
    // Багфикс: contains в PostgreSQL регистрозависим — @Yuna не считался
    // упоминанием @yuna, хотя клиент и сервер создания уведомлений считали
    // иначе. mode: "insensitive" выравнивает поведение.
    const mentioned = await prisma.message.groupBy({
      by: ["channelId"],
      where: {
        ...baseWhere,
        AND: [
          {
            OR: [
              { content: { contains: `@${uname}`, mode: "insensitive" as const } },
              { content: { contains: "@everyone" } },
            ],
          },
        ],
      },
      _count: { _all: true },
    });
    for (const g of mentioned) {
      if (g._count._all > 0) mentionChannels[g.channelId] = true;
    }
  }

  // FIX-NTF2: карта канал → группа/название, чтобы клиент мог показать,
  // из какого сообщества и какого чата пришли непрочитанные.
  const channelInfo: Record<string, { groupId: string; name: string }> = {};
  const unreadIds = Object.keys(unreadCounts);
  if (unreadIds.length > 0) {
    const chans = await prisma.channel.findMany({
      where: { id: { in: unreadIds } },
      select: { id: true, groupId: true, name: true },
    });
    for (const chnl of chans) {
      if (chnl.groupId) channelInfo[chnl.id] = { groupId: chnl.groupId, name: chnl.name };
    }
  }

  return NextResponse.json({ unread: unreadCounts, mentions: mentionChannels, channels: channelInfo });
}
