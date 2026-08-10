import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

// FIX-ADM1: сводные метрики для раздела «Сервисы и система» (админ + редактор)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user.role !== "ADMIN" && session.user.role !== "EDITOR")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = Date.now();
  const onlineSince = new Date(now - 60_000);
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

  // FIX-ADMCOUNT: счётчики обзора считаются здесь, а не собираются клиентом из
  // пользовательских списков. Прежде «Каналов» брались из GET /api/channels,
  // который без groupId по своей природе отдаёт пустой массив, — отсюда и
  // стабильный ноль при непустой базе.
  const [
    onlineNow,
    channelMessages,
    directMessages,
    users,
    groups,
    channels,
    articles,
    services,
    activeServices,
    serverNodes,
    games,
  ] = await Promise.all([
    prisma.user.count({ where: { lastSeen: { gte: onlineSince } } }),
    prisma.message.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.directMessage.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.user.count(),
    prisma.group.count(),
    prisma.channel.count(),
    prisma.article.count(),
    prisma.service.count(),
    prisma.service.count({ where: { active: true } }),
    prisma.serverNode.count(),
    // GAMES-CATALOG: счётчик каталога игр для строки «Игры» в обзоре.
    prisma.gameEntry.count(),
  ]);

  return NextResponse.json({
    onlineNow,
    messages24h: channelMessages + directMessages,
    counts: { users, groups, channels, articles, services, activeServices, serverNodes, games },
    // Заглушки: реальные источники метрик будут подключены позже
    activeProjects: null,
    systemErrors: null,
    aiRequests: null,
    storageUsage: null,
    serverLoad: null,
  });
}
