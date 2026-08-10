import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

// NEW: статистика активности сообщества для вкладки «Обзор».
// Доступна любому участнику группы.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
  });

  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const d30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

  const [
    membersTotal,
    joins7d,
    joins30d,
    messages7d,
    messages30d,
    activeSenders,
    bansTotal,
    invitesActive,
    topRaw,
  ] = await Promise.all([
    prisma.groupMember.count({ where: { groupId: id } }),
    prisma.groupMember.count({ where: { groupId: id, joinedAt: { gte: d7 } } }),
    prisma.groupMember.count({ where: { groupId: id, joinedAt: { gte: d30 } } }),
    prisma.message.count({ where: { channel: { groupId: id }, createdAt: { gte: d7 } } }),
    prisma.message.count({ where: { channel: { groupId: id }, createdAt: { gte: d30 } } }),
    prisma.message.findMany({
      where: { channel: { groupId: id }, createdAt: { gte: d7 } },
      distinct: ["userId"],
      select: { userId: true },
    }),
    prisma.groupBan.count({ where: { groupId: id } }),
    prisma.invite.count({
      where: { groupId: id, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    }),
    prisma.message.groupBy({
      by: ["channelId"],
      where: { channel: { groupId: id }, createdAt: { gte: d30 } },
      _count: { _all: true },
      orderBy: { _count: { channelId: "desc" } },
      take: 5,
    }),
  ]);

  const channels = await prisma.channel.findMany({
    where: { id: { in: topRaw.map((t) => t.channelId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(channels.map((c) => [c.id, c.name]));

  return NextResponse.json({
    membersTotal,
    joins7d,
    joins30d,
    messages7d,
    messages30d,
    activeMembers7d: activeSenders.length,
    bansTotal,
    invitesActive,
    topChannels30d: topRaw.map((t) => ({
      channelId: t.channelId,
      name: nameById.get(t.channelId) ?? "—",
      messages: t._count._all,
    })),
  });
}
