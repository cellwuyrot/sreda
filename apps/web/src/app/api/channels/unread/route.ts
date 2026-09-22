import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasEveryoneMention, parseMentions } from "@/lib/mentions";

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
    AND: [
      { OR: perChannelWindow },
      // Вариант A: replies входят в unread канала, но только пока для них нет
      // адресного MessageRead текущего пользователя. Верхний уровень по-прежнему
      // закрывается ChannelMember.lastRead.
      { OR: [
        { threadId: null },
        { threadId: { not: null }, reads: { none: { userId: session.user.id } } },
      ] },
    ],
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
    // FIX-FEED: у улучшенного чата та же таблица и те же черновики, что у новостей.
    channelRows.filter((c) => c.type === "NEWS" || c.type === "FEED").map((c) => c.id),
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
  if (memberships.length > 0) {
    /* Никаких contains("@username"): POST уже хранит вычисленные сервером ID,
       а @everyone проверяется тем же parser, что renderer и отправка. */
    const candidates = await prisma.message.findMany({
      where: {
        ...baseWhere,
      },
      select: { channelId: true, content: true, mentions: true },
    });
    for (const message of candidates) {
      let ids: string[] = [];
      try { ids = message.mentions ? JSON.parse(message.mentions) : []; } catch { ids = []; }
      // parseMentions вызван явно и для обычного токена: это сохраняет единое
      // правило и для старых строк, созданных до серверного поля mentions.
      const hasTokens = parseMentions(message.content).length > 0;
      if (hasTokens && (ids.includes(session.user.id) || hasEveryoneMention(message.content))) {
        mentionChannels[message.channelId] = true;
      }
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
