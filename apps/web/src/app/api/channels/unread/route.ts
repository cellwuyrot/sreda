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

  const unreadCounts: Record<string, number> = {};
  const grouped = await prisma.message.groupBy({
    by: ["channelId"],
    where: baseWhere,
    _count: { _all: true },
  });
  for (const g of grouped) {
    if (g._count._all > 0) unreadCounts[g.channelId] = g._count._all;
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
