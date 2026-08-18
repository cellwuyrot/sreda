import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { checkBan } from "@/lib/banCheck";
import { rateLimit } from "@/lib/rateLimit";
import { getChannelPermissions } from "@/lib/connectPermissions";
import { messageLengthError } from "@/lib/messageLimits";
import {
  NEWS_POST_INCLUDE,
  announceNewsPost,
  comparePostsForFeed,
  normalizePostTitle,
  parseFeedCursor,
  parseFeedLimit,
  parsePublishAt,
  sanitizePostCover,
  serializeNewsPost,
  shouldAnnouncePost,
} from "@/lib/newsPost";

/**
 * NEWSPOST: лента канала «Новости».
 *
 *   GET  — страница ленты (закреплённое сверху, дальше по убыванию даты).
 *   POST — опубликовать пост (или отложить публикацию / сохранить черновик).
 *
 * ── Почему закреплённые выбираются отдельным запросом ───────────────────────
 *
 * Курсор постраничной выдачи идёт по дате. Если тащить закреплённые тем же
 * запросом, старое закрепление ведёт себя одинаково плохо в обе стороны: при
 * сортировке «сначала закреплённые» оно повторяется на КАЖДОЙ странице, а без
 * такой сортировки — проваливается вниз и на первом экране его нет, то есть
 * закрепление перестаёт работать. Поэтому закреплённые берутся один раз, на
 * первой странице, а курсор листает только остальное.
 *
 * ── Чего в ленте нет ────────────────────────────────────────────────────────
 *
 * Комментариев (сообщений с threadId) — они живут под своим постом, а не в
 * ленте. И чужих черновиков с ещё не наступившими публикациями: условие
 * видимости уходит в сам запрос, а не отсеивается после выборки, иначе
 * страница из двадцати постов иногда возвращала бы пятнадцать.
 */

/** Сколько закреплённых постов показывать. Больше — это уже не «закрепление». */
const MAX_PINNED = 10;

/** Вложений столько же, сколько у сообщения: те же загрузки, тот же виджет. */
const MAX_ATTACHMENTS = 10;

/**
 * Условие «этот пост человеку виден» прямо в запросе.
 *
 * Своё видно всегда — черновик и отложенный в том числе, с пометкой. Чужое —
 * только опубликованное и только когда время наступило.
 */
function visibleToViewer(viewerId: string, now: Date) {
  return {
    threadId: null,
    OR: [
      { userId: viewerId },
      { draft: false, OR: [{ publishAt: null }, { publishAt: { lte: now } }] },
    ],
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: channelId } = await params;
  const permission = await getChannelPermissions(session.user.id, channelId);
  if (!permission) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  if (!permission.canView) {
    return NextResponse.json({ error: permission.denialReason ?? "Forbidden" }, { status: 403 });
  }
  /* Лента осмысленна только в новостном канале: в остальных поля поста пустые,
     и клиент получил бы список сообщений, притворяющийся постами. */
  // FIX-FEED: лента есть и у улучшенного чата (FEED), а не только у новостей.
  if (permission.channelType !== "NEWS" && permission.channelType !== "FEED") {
    return NextResponse.json({ error: "Этот раздел не является лентой новостей" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const cursor = parseFeedCursor(searchParams.get("cursor"));
  const limit = parseFeedLimit(searchParams.get("limit"));
  const now = new Date();
  const visible = visibleToViewer(session.user.id, now);

  /* Закреплённые — только на первой странице (см. пояснение вверху файла). */
  const pinned = cursor
    ? []
    : await prisma.message.findMany({
        where: { ...visible, channelId, pinned: true },
        include: NEWS_POST_INCLUDE,
        orderBy: { createdAt: "desc" },
        take: MAX_PINNED,
      });

  const rest = await prisma.message.findMany({
    where: {
      ...visible,
      channelId,
      pinned: false,
      ...(cursor ? { createdAt: { lt: cursor } } : {}),
    },
    include: NEWS_POST_INCLUDE,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });

  const hasMore = rest.length > limit;
  if (hasMore) rest.pop();

  const viewer = { userId: session.user.id, canModerate: permission.canModerate };
  const posts = [...pinned, ...rest].sort(comparePostsForFeed).map((row) => serializeNewsPost(row, viewer));

  return NextResponse.json({
    posts,
    /* Курсор считается по НЕзакреплённым: закреплённые в постраничной выдаче не
       участвуют, и их дата увела бы следующую страницу не туда. */
    nextCursor: hasMore ? rest[rest.length - 1]!.createdAt.toISOString() : null,
    canPost: permission.canPost,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = await rateLimit(req, "news-posts", { limit: 20, windowMs: 60 * 1000 });
  if (limited) return limited;

  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  /* Сессия на JWT не аннулируется при бане: без этой проверки забаненный с
     живым токеном продолжал бы публиковать новости. */
  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id: channelId } = await params;
  const permission = await getChannelPermissions(session.user.id, channelId);
  if (!permission) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  if (!permission.canView) {
    return NextResponse.json({ error: permission.denialReason ?? "Forbidden" }, { status: 403 });
  }
  // FIX-FEED: лента есть и у улучшенного чата (FEED), а не только у новостей.
  if (permission.channelType !== "NEWS" && permission.channelType !== "FEED") {
    return NextResponse.json({ error: "Этот раздел не является лентой новостей" }, { status: 400 });
  }
  /* Публикует только модерация — то же правило, что и раньше в /api/messages.
     Комментировать при этом может любой читатель, см. connectPermissions. */
  if (!permission.canPost) {
    return NextResponse.json({ error: permission.denialReason ?? "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    title?: unknown;
    content?: unknown;
    cover?: unknown;
    attachments?: unknown;
    draft?: unknown;
    publishAt?: unknown;
    commentsClosed?: unknown;
  } | null;

  const title = normalizePostTitle(body?.title);
  const content = typeof body?.content === "string" ? sanitizeText(body.content) : "";
  if (content) {
    const lengthError = messageLengthError(content);
    if (lengthError) return NextResponse.json({ error: lengthError }, { status: 400 });
  }

  /* Обложку не «чистим молча»: тихо выброшенная картинка выглядит как потеря
     файла, и человек грузит её второй раз с тем же результатом. */
  let cover: string | null = null;
  if (body?.cover !== undefined && body.cover !== null && body.cover !== "") {
    cover = sanitizePostCover(body.cover);
    if (!cover) return NextResponse.json({ error: "Обложка должна быть файлом из хранилища" }, { status: 400 });
  }

  const attachments = body?.attachments;
  if (attachments != null && !isValidAttachments(attachments)) {
    return NextResponse.json({ error: "Некорректные вложения" }, { status: 400 });
  }
  const attachmentList = Array.isArray(attachments) ? attachments : [];

  const publishAt = parsePublishAt(body?.publishAt);
  if (!publishAt.ok) return NextResponse.json({ error: "Некорректное время публикации" }, { status: 400 });

  /* Пустой пост создать нельзя, но «пустой» здесь шире, чем у сообщения: пост
     из одного заголовка или одной обложки — нормальное объявление. */
  if (!content && !title && !cover && attachmentList.length === 0) {
    return NextResponse.json({ error: "Пост не может быть пустым" }, { status: 400 });
  }

  const draft = body?.draft === true;
  const post = await prisma.message.create({
    data: {
      channelId,
      userId: session.user.id,
      content,
      title: title || null,
      cover,
      attachments: attachmentList.length > 0 ? JSON.stringify(attachmentList) : null,
      draft,
      publishAt: publishAt.value,
      commentsClosed: body?.commentsClosed === true,
    },
    include: NEWS_POST_INCLUDE,
  });

  /* Уведомление уходит только у того поста, который прямо сейчас стал виден.
     Черновик и отложенный молчат: первый — навсегда, второй — до своего часа,
     когда его подберёт обход в server.ts. Сбой рассылки не отменяет
     публикацию: пост уже создан, и падать после этого поздно. */
  if (shouldAnnouncePost(post)) {
    await announceNewsPost(post.id).catch((err) => console.error("[news] рассылка не удалась:", err));
  }

  return NextResponse.json({
    post: serializeNewsPost(post, { userId: session.user.id, canModerate: permission.canModerate }),
  });
}

/**
 * Вложения проверяются так же, как в /api/messages: только пути в наше
 * хранилище. Иначе поле превращается в способ разместить в ленте ссылку на
 * чужой сервер, оформленную как наш файл.
 */
function isValidAttachments(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) return false;
  return value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const url = (item as { url?: unknown }).url;
    return typeof url === "string" && url.startsWith("/uploads/") && !url.includes("..");
  });
}
