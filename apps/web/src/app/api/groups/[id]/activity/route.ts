import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import prisma from "@/lib/prisma";

// FIX-COMMUNITY: сводная активность участников группы для раздела
// «Общественность»: сообщения, время в голосовых (GroupMember.voiceSeconds,
// копится в server.ts при выходе из голосового), решённые задачи (закрытые
// задачи исполнителя) и вклад в базу знаний (статьи и термины, где участник —
// автор последней правки). Доступно только участникам группы.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: groupId } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const me = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId } },
    select: { id: true },
  });
  if (!me) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const limited = await rateLimit(req, `activity:${groupId}`, { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const members = await prisma.groupMember.findMany({
    where: { groupId },
    select: {
      role: true,
      joinedAt: true,
      voiceSeconds: true,
      user: {
        select: {
          id: true, name: true, username: true, avatar: true, role: true,
          avatarGlowEnabled: true, avatarGlowColors: true,
        },
      },
    },
  });

  const [messages, tasksDone, wiki] = await Promise.all([
    prisma.message.groupBy({
      by: ["userId"],
      where: { channel: { groupId }, deleted: false },
      _count: { _all: true },
    }),
    prisma.channelTask.groupBy({
      by: ["assigneeId"],
      where: { channel: { groupId }, closedAt: { not: null }, assigneeId: { not: null } },
      _count: { _all: true },
    }),
    prisma.wikiArticle.groupBy({
      by: ["updatedById"],
      where: { channel: { groupId }, updatedById: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const msgBy = new Map(messages.map((m) => [m.userId, m._count._all]));
  const taskBy = new Map(tasksDone.map((t) => [t.assigneeId as string, t._count._all]));
  const wikiBy = new Map(wiki.map((w) => [w.updatedById as string, w._count._all]));

  const rows = members.map((m) => ({
    user: m.user,
    role: m.role,
    joinedAt: m.joinedAt,
    messages: msgBy.get(m.user.id) ?? 0,
    voiceSeconds: m.voiceSeconds,
    tasksDone: taskBy.get(m.user.id) ?? 0,
    wiki: wikiBy.get(m.user.id) ?? 0,
  }));

  return NextResponse.json({ members: rows });
}
