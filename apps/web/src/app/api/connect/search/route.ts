import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getChannelPermissionsBatch } from "@/lib/connectPermissions";
import { rateLimit } from "@/lib/rateLimit";

/**
 * Права на каналы считались в цикле: getChannelPermissions на каждый канал, а
 * внутри неё два запроса. У человека в пяти сообществах по два десятка каналов
 * это больше двух сотен запросов — и всё это на маршруте, который клиент зовёт
 * при наборе строки. Теперь права берутся пакетом: два запроса на весь список
 * (getChannelPermissionsBatch), правила при этом ровно те же.
 */

const SCOPES = ["all", "messages", "channels", "members", "tasks", "wiki", "calendar"] as const;
type Scope = (typeof SCOPES)[number];

/** Верхняя граница на список каналов, по которым идёт поиск. */
const MAX_SEARCHED_CHANNELS = 500;

type SearchItem = {
  id: string;
  type: Exclude<Scope, "all">;
  title: string;
  subtitle: string;
  snippet?: string;
  groupId?: string;
  channelId?: string;
  url: string;
};

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = await rateLimit(req, `connect-search:${session.user.id}`, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const requested = req.nextUrl.searchParams.get("scope") ?? "all";
  const scope: Scope = SCOPES.includes(requested as Scope) ? (requested as Scope) : "all";
  if (q.length < 2) return NextResponse.json({ results: [] });

  const memberships = await prisma.groupMember.findMany({
    where: { userId: session.user.id },
    select: { groupId: true, group: { select: { name: true } } },
  });
  const groupIds = memberships.map((entry) => entry.groupId);
  const groupNames = new Map(memberships.map((entry) => [entry.groupId, entry.group.name]));
  if (groupIds.length === 0) return NextResponse.json({ results: [] });

  const include = (candidate: Scope) => scope === "all" || scope === candidate;
  const results: SearchItem[] = [];

  if (include("channels")) {
    const channels = await prisma.channel.findMany({
      // FIX-HIDDEN: скрытые каналы не отфильтровываются здесь жёстко —
      // canView ниже отсекает их для обычных участников и оставляет для
      // модераторов и выше.
      where: { groupId: { in: groupIds }, name: { contains: q, mode: "insensitive" } },
      select: { id: true, name: true, type: true, groupId: true },
      take: 20,
      orderBy: { updatedAt: "desc" },
    });
    const permissions = await getChannelPermissionsBatch(
      session.user.id,
      channels.map((channel) => channel.id),
    );
    for (const channel of channels) {
      if (!permissions.get(channel.id)?.canView) continue;
      results.push({ id: channel.id, type: "channels", title: channel.name, subtitle: `${groupNames.get(channel.groupId) ?? "Сообщество"} · ${channel.type}`, groupId: channel.groupId, channelId: channel.id, url: `/connect?group=${channel.groupId}&channel=${channel.id}` });
    }
  }

  const candidateChannels = await prisma.channel.findMany({
    where: { groupId: { in: groupIds } },
    select: { id: true, name: true, groupId: true },
    take: MAX_SEARCHED_CHANNELS,
  });
  const candidatePermissions = await getChannelPermissionsBatch(
    session.user.id,
    candidateChannels.map((channel) => channel.id),
  );
  const allowedChannels = candidateChannels.filter((channel) => candidatePermissions.get(channel.id)?.canView);
  const channelIds = allowedChannels.map((channel) => channel.id);
  const channelById = new Map(allowedChannels.map((channel) => [channel.id, channel]));

  if (include("messages") && channelIds.length > 0) {
    /* Предел глубины истории отозван: поиск идёт по всей переписке, как и
       прокрутка канала. */
    const messages = await prisma.message.findMany({
      where: {
        channelId: { in: channelIds }, deleted: false, threadId: null,
        content: { contains: q, mode: "insensitive" },
      },
      select: { id: true, content: true, channelId: true, user: { select: { name: true } }, createdAt: true },
      take: 30,
      orderBy: { createdAt: "desc" },
    });
    for (const message of messages) {
      const channel = channelById.get(message.channelId);
      if (!channel) continue;
      results.push({ id: message.id, type: "messages", title: message.user.name, subtitle: `${groupNames.get(channel.groupId) ?? "Сообщество"} · #${channel.name}`, snippet: message.content.slice(0, 180), groupId: channel.groupId, channelId: channel.id, url: `/connect?group=${channel.groupId}&channel=${channel.id}&message=${message.id}` });
    }
  }

  if (include("members")) {
    const members = await prisma.groupMember.findMany({
      where: { groupId: { in: groupIds }, OR: [{ user: { name: { contains: q, mode: "insensitive" } } }, { user: { username: { contains: q, mode: "insensitive" } } }] },
      select: { id: true, groupId: true, user: { select: { id: true, name: true, username: true } } },
      take: 20,
    });
    for (const member of members) results.push({ id: member.id, type: "members", title: member.user.name, subtitle: `@${member.user.username} · ${groupNames.get(member.groupId) ?? "Сообщество"}`, groupId: member.groupId, url: `/profile/${member.user.username}` });
  }

  if (include("tasks") && channelIds.length > 0) {
    const tasks = await prisma.channelTask.findMany({
      where: { channelId: { in: channelIds }, OR: [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] },
      select: { id: true, number: true, title: true, description: true, status: true, channelId: true },
      take: 25,
      orderBy: { updatedAt: "desc" },
    });
    for (const task of tasks) {
      const channel = channelById.get(task.channelId); if (!channel) continue;
      results.push({ id: task.id, type: "tasks", title: `#${task.number} ${task.title}`, subtitle: `${groupNames.get(channel.groupId) ?? "Сообщество"} · ${task.status}`, snippet: task.description?.slice(0, 180), groupId: channel.groupId, channelId: channel.id, url: `/connect?group=${channel.groupId}&channel=${channel.id}&task=${task.id}` });
    }
  }

  if (include("wiki") && channelIds.length > 0) {
    const articles = await prisma.wikiArticle.findMany({
      where: { channelId: { in: channelIds }, OR: [{ title: { contains: q, mode: "insensitive" } }, { content: { contains: q, mode: "insensitive" } }] },
      select: { id: true, title: true, content: true, channelId: true }, take: 20, orderBy: { updatedAt: "desc" },
    });
    for (const article of articles) { const channel = channelById.get(article.channelId); if (!channel) continue; results.push({ id: article.id, type: "wiki", title: article.title, subtitle: `${groupNames.get(channel.groupId) ?? "Сообщество"} · Wiki`, snippet: article.content.slice(0, 180), groupId: channel.groupId, channelId: channel.id, url: `/connect?group=${channel.groupId}&channel=${channel.id}` }); }
  }

  if (include("calendar") && channelIds.length > 0) {
    const events = await prisma.calendarEvent.findMany({
      where: { channelId: { in: channelIds }, OR: [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] },
      select: { id: true, title: true, description: true, start: true, channelId: true }, take: 20, orderBy: { start: "asc" },
    });
    for (const event of events) { const channel = channelById.get(event.channelId); if (!channel) continue; results.push({ id: event.id, type: "calendar", title: event.title, subtitle: `${groupNames.get(channel.groupId) ?? "Сообщество"} · ${event.start.toLocaleDateString("ru-RU")}`, snippet: event.description?.slice(0, 180), groupId: channel.groupId, channelId: channel.id, url: `/connect?group=${channel.groupId}&channel=${channel.id}` }); }
  }

  return NextResponse.json({ results: results.slice(0, scope === "all" ? 60 : 40) });
}
