import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { getVisibleChannelIds } from "@/lib/connectPermissions";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // FIX-SEC-RL: поиск делает до 3 тяжёлых ILIKE-запросов по крупным таблицам —
  // ограничиваем частоту, чтобы им нельзя было нагружать БД.
  const limited = await rateLimit(req, `search:${session.user.id}`, { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q")?.trim();
  const type = searchParams.get("type") || "all";
  const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 50);

  if (!query || query.length < 2) {
    return NextResponse.json({ error: "Query must be at least 2 characters" }, { status: 400 });
  }

  const results: {
    articles?: unknown[];
    messages?: unknown[];
    users?: unknown[];
  } = {};

  if (type === "all" || type === "articles") {
    const articles = await prisma.article.findMany({
      where: {
        published: true,
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { content: { contains: query, mode: "insensitive" } },
          { tags: { contains: query, mode: "insensitive" } },
          { category: { contains: query, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        title: true,
        slug: true,
        category: true,
        tags: true,
        content: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    results.articles = articles.map((a) => ({
      ...a,
      snippet: extractSnippet(a.content, query),
      content: undefined,
    }));
  }

  if (type === "all" || type === "messages") {
    /* FIX-SEC-SEARCH: здесь брались ВСЕ каналы всех сообществ, где пользователь
       состоит, и по ним искался текст сообщений. Прав канала маршрут не знал
       вовсе: ни скрытых каналов, ни ограничения по ролям, ни закрытого чтения.
       Обычный участник одним запросом доставал переписку модераторских и
       скрытых каналов вместе с именем канала и сообщества.

       Теперь список каналов приходит из общей проверки прав — той же, что
       стоит в чтении канала и в поиске раздела «Связь». */
    const channelIds = await getVisibleChannelIds(session.user.id);

    if (channelIds.length > 0) {
      /* Предел глубины истории отозван: поиск идёт по всей переписке. */
      const messages = await prisma.message.findMany({
        where: {
          channelId: { in: channelIds },
          deleted: false,
          content: { contains: query, mode: "insensitive" },
        },
        select: {
          id: true,
          content: true,
          createdAt: true,
          channelId: true,
          user: {
            select: { id: true, name: true, username: true, avatar: true },
          },
          channel: {
            select: { id: true, name: true, group: { select: { id: true, name: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      results.messages = messages.map((m) => ({
        ...m,
        snippet: extractSnippet(m.content, query),
      }));
    } else {
      results.messages = [];
    }
  }

  if (type === "all" || type === "users") {
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { username: { contains: query, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        username: true,
        avatar: true,
        role: true,
        avatarGlowEnabled: true,
        avatarGlowColors: true,
      },
      take: limit,
    });
    results.users = users;
  }

  return NextResponse.json(results);
}

function extractSnippet(text: string, query: string, contextChars = 80): string {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return text.slice(0, contextChars * 2);

  const start = Math.max(0, idx - contextChars);
  const end = Math.min(text.length, idx + query.length + contextChars);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  return snippet;
}
