import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { checkBan } from "@/lib/banCheck";
import { rateLimit } from "@/lib/rateLimit";
import { getActiveTimeout } from "@/lib/moderation";
import { checkCensor, recordCensorHits } from "@/lib/censorService";
import { messageLengthError } from "@/lib/messageLimits";
import { loadPostForViewer, parseFeedCursor, parseFeedLimit } from "@/lib/newsPost";

/**
 * NEWSPOST: обсуждение под постом.
 *
 * ── Почему комментарий — это сообщение с threadId ───────────────────────────
 *
 * Ветка обсуждения у сообщений уже есть, и она делает ровно то, что нужно
 * комментариям. Своя таблица дала бы второй комплект правки, удаления,
 * модерации и счётчиков — и вторую очередь багов к ним.
 *
 * ── Кто может комментировать ────────────────────────────────────────────────
 *
 * Любой, кто может читать канал (permission.canComment). Прежний запрет «в
 * новостях пишет только модерация» относится к ПОСТАМ: лента, в которой
 * отвечать может одна модерация, — это тот же молчащий канал, из которого
 * новости и вытаскивали. Отдельно спрашивается сам пост: у закрытого
 * (commentsClosed) не пишет никто, включая модерацию, — иначе «закрыть
 * обсуждение» ничего не значит.
 *
 * Тайм-аут и словарь сообщества действуют здесь так же, как в переписке. Без
 * них комментарии стали бы обходным путём для обоих ограничений.
 */

/** Порядок — от старых к новым, как читают обсуждение. */
const COMMENT_INCLUDE = {
  user: { select: { id: true, name: true, username: true, avatar: true } },
} as const;

interface CommentRow {
  id: string;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  userId: string;
  user: { id: string; name: string; username: string; avatar: string | null };
}

function serializeComment(row: CommentRow, viewer: { userId: string; canModerate: boolean }) {
  return {
    id: row.id,
    content: row.content,
    author: {
      id: row.user.id,
      name: row.user.name,
      username: row.user.username,
      avatar: row.user.avatar ?? null,
    },
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    /* Удаление идёт через общий DELETE /api/messages: там уже разобраны и
       автор, и модерация группы, и администратор платформы. Здесь только
       подсказка интерфейсу, показывать ли пункт меню. */
    canDelete: row.userId === viewer.userId || viewer.canModerate,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const access = await loadPostForViewer(id, session.user.id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const { post, permission } = access;
  const { searchParams } = new URL(req.url);
  const cursor = parseFeedCursor(searchParams.get("cursor"));
  const limit = parseFeedLimit(searchParams.get("limit"));

  const rows = await prisma.message.findMany({
    where: {
      threadId: post.id,
      /* Курсор идёт вперёд по времени: обсуждение читают сверху вниз, и
         «показать ещё» дочитывает более новое, а не более старое. */
      ...(cursor ? { createdAt: { gt: cursor } } : {}),
    },
    include: COMMENT_INCLUDE,
    orderBy: { createdAt: "asc" },
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();

  const viewer = { userId: session.user.id, canModerate: permission.canModerate };
  return NextResponse.json({
    comments: rows.map((row) => serializeComment(row, viewer)),
    nextCursor: hasMore ? rows[rows.length - 1]!.createdAt.toISOString() : null,
    canComment: permission.canComment && !post.commentsClosed,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = await rateLimit(req, "post-comments", { limit: 30, windowMs: 60 * 1000 });
  if (limited) return limited;

  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id } = await params;
  const access = await loadPostForViewer(id, session.user.id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const { post, permission } = access;
  if (!permission.canComment) {
    return NextResponse.json({ error: permission.denialReason ?? "Forbidden" }, { status: 403 });
  }
  /* Закрытое обсуждение закрыто для всех — иначе кнопка «закрыть комментарии»
     означала бы лишь «закрыть для остальных». */
  if (post.commentsClosed) {
    return NextResponse.json({ error: "Комментарии к этому посту закрыты" }, { status: 403 });
  }
  /* Черновик и отложенный пост своего автора обсуждать не с кем: посторонние
     их не видят, и комментарий появился бы раньше самой новости. */
  if (post.draft || (post.publishAt && post.publishAt.getTime() > Date.now())) {
    return NextResponse.json({ error: "Пост ещё не опубликован" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { content?: unknown } | null;
  const content = typeof body?.content === "string" ? sanitizeText(body.content) : "";
  if (!content) return NextResponse.json({ error: "Комментарий не может быть пустым" }, { status: 400 });
  const lengthError = messageLengthError(content);
  if (lengthError) return NextResponse.json({ error: lengthError }, { status: 400 });

  const isPrivileged = permission.canModerate;
  if (!isPrivileged) {
    /* Тайм-аут выдают за поведение в канале целиком. Не проверь мы его здесь,
       ограниченный человек продолжал бы писать — просто под постами. */
    const timeout = await getActiveTimeout(session.user.id, post.channelId);
    if (timeout) {
      const until = new Date(timeout.mutedUntil).toLocaleString("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
      return NextResponse.json(
        {
          error: `Вы временно ограничены в отправке сообщений (до ${until})${timeout.muteReason ? ` — ${timeout.muteReason}` : ""}`,
          mutedUntil: timeout.mutedUntil,
        },
        { status: 403 },
      );
    }
  }

  /* Словарь сообщества — до создания комментария: запрет должен отказать в
     отправке, а не удалять отправленное. Модерацию не проверяем: правило
     устанавливают они же. */
  const censor = isPrivileged
    ? { matches: [], level: null, blocked: false }
    : await checkCensor(permission.groupId, content);
  if (censor.blocked) {
    await recordCensorHits({
      groupId: permission.groupId,
      userId: session.user.id,
      channelId: post.channelId,
      matches: censor.matches,
    });
    return NextResponse.json(
      { error: "Комментарий не отправлен: в тексте есть слова, запрещённые в этом сообществе", censored: true },
      { status: 422 },
    );
  }

  const comment = await prisma.message.create({
    data: {
      content,
      channelId: post.channelId,
      userId: session.user.id,
      threadId: post.id,
    },
    include: COMMENT_INCLUDE,
  });

  /* Счётчик на посте поддерживается ради совместимости с виджетом веток в
     переписке; лента считает комментарии пересчётом (см. serializeNewsPost) и
     на это число не полагается. */
  await prisma.message.update({ where: { id: post.id }, data: { threadCount: { increment: 1 } } });

  if (censor.matches.length > 0) {
    await recordCensorHits({
      groupId: permission.groupId,
      userId: session.user.id,
      channelId: post.channelId,
      matches: censor.matches,
    });
  }

  return NextResponse.json({
    comment: serializeComment(comment, { userId: session.user.id, canModerate: permission.canModerate }),
  });
}
