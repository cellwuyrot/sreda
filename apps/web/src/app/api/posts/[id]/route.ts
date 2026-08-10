import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { sanitizeText } from "@/lib/sanitize";
import { checkBan } from "@/lib/banCheck";
import { messageLengthError } from "@/lib/messageLimits";
import { deleteSubjectNotifications } from "@/lib/createNotification";
import {
  NEWS_POST_INCLUDE,
  announceNewsPost,
  loadPostForViewer,
  normalizePostTitle,
  parsePublishAt,
  sanitizePostCover,
  serializeNewsPost,
  shouldAnnouncePost,
} from "@/lib/newsPost";

/**
 * NEWSPOST: один пост ленты.
 *
 *   PATCH  — правка, закрепление, закрытие комментариев, публикация черновика.
 *   DELETE — удалить пост вместе с обсуждением.
 *
 * ── Кто что может ───────────────────────────────────────────────────────────
 *
 * Править и удалять — автор или модерация. Закреплять — только модерация:
 * закрепление меняет не свой пост, а весь верх ленты, и отдавать его каждому,
 * кто однажды получил право публиковать, нельзя.
 *
 * Сам факт существования чужого черновика тоже закрыт: он отвечает 404, а не
 * 403 (см. loadPostForViewer) — иначе по коду ответа было бы видно, что автор
 * что-то пишет.
 */

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const banned = await checkBan(session.user.id);
  if (banned) return banned;

  const { id } = await params;
  const access = await loadPostForViewer(id, session.user.id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const { post, permission } = access;
  const isAuthor = post.userId === session.user.id;
  if (!isAuthor && !permission.canModerate) {
    return NextResponse.json({ error: "Изменить пост может автор или модератор" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    title?: unknown;
    content?: unknown;
    cover?: unknown;
    commentsClosed?: unknown;
    pinned?: unknown;
    draft?: unknown;
    publishAt?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: "Пустой запрос" }, { status: 400 });

  const data: Record<string, unknown> = {};
  /* Правкой считается изменение того, что видно читателю как текст поста.
     Закрепление или закрытие комментариев пометку «изменено» не ставят: это
     действия модерации, а не переписывание новости. */
  let rewritten = false;

  if (body.title !== undefined) {
    const title = normalizePostTitle(body.title);
    data.title = title || null;
    rewritten = rewritten || title !== (post.title ?? "");
  }

  if (body.content !== undefined) {
    if (typeof body.content !== "string") return NextResponse.json({ error: "Некорректный текст" }, { status: 400 });
    const content = sanitizeText(body.content);
    const lengthError = content ? messageLengthError(content) : null;
    if (lengthError) return NextResponse.json({ error: lengthError }, { status: 400 });
    data.content = content;
    rewritten = rewritten || content !== post.content;
  }

  if (body.cover !== undefined) {
    /* Пустая строка и null — «убрать обложку»; всё остальное обязано быть
       файлом из хранилища, иначе правкой можно было бы обойти проверку,
       пройденную при создании. */
    if (body.cover === null || body.cover === "") {
      data.cover = null;
    } else {
      const cover = sanitizePostCover(body.cover);
      if (!cover) return NextResponse.json({ error: "Обложка должна быть файлом из хранилища" }, { status: 400 });
      data.cover = cover;
    }
    rewritten = true;
  }

  if (body.commentsClosed !== undefined) {
    if (typeof body.commentsClosed !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение" }, { status: 400 });
    }
    data.commentsClosed = body.commentsClosed;
  }

  if (body.pinned !== undefined) {
    if (typeof body.pinned !== "boolean") return NextResponse.json({ error: "Некорректное значение" }, { status: 400 });
    /* Закрепление меняет верх ленты для всего сообщества — это работа
       модерации, а не право автора распорядиться своим постом. */
    if (!permission.canModerate) {
      return NextResponse.json({ error: "Закреплять посты может только модератор" }, { status: 403 });
    }
    data.pinned = body.pinned;
    data.pinnedBy = body.pinned ? session.user.id : null;
    data.pinnedAt = body.pinned ? new Date() : null;
  }

  if (body.draft !== undefined) {
    if (typeof body.draft !== "boolean") return NextResponse.json({ error: "Некорректное значение" }, { status: 400 });
    /* Обратно в черновик опубликованный пост не возвращается: его уже видели,
       уже прокомментировали и о нём уже пришло уведомление. «Спрятать»
       означало бы, что обсуждение исчезло у всех, кроме автора, — для этого
       есть удаление. */
    if (!body.draft) data.draft = false;
    else if (post.draft) data.draft = true;
    else return NextResponse.json({ error: "Опубликованный пост нельзя вернуть в черновики" }, { status: 400 });
  }

  if (body.publishAt !== undefined) {
    const publishAt = parsePublishAt(body.publishAt);
    if (!publishAt.ok) return NextResponse.json({ error: "Некорректное время публикации" }, { status: 400 });
    if (post.announcedAt) {
      /* Вышедшую новость назад в расписание не убрать: сдвиг даты её уже не
         спрячет, а лишь разойдётся с тем, что люди прочитали. Пустое значение
         при этом молча пропускаем — редактор шлёт поле в каждой правке, и
         отказывать за «publishAt: null» у обычной новости было бы отказом
         править её вообще. */
      if (publishAt.value) {
        return NextResponse.json({ error: "Пост уже опубликован — время изменить нельзя" }, { status: 400 });
      }
    } else {
      data.publishAt = publishAt.value;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Нечего изменять" }, { status: 400 });
  }
  if (rewritten) {
    data.edited = true;
    data.editedAt = new Date();
  }

  const updated = await prisma.message.update({
    where: { id: post.id },
    data,
    include: NEWS_POST_INCLUDE,
  });

  /* Черновик стал постом (или наступило перенесённое время) — самое время
     уведомить. announcedAt внутри защищает от повторной рассылки, поэтому
     звать можно после любой правки. */
  if (shouldAnnouncePost(updated)) {
    await announceNewsPost(updated.id).catch((err) => console.error("[news] рассылка не удалась:", err));
  }

  return NextResponse.json({
    post: serializeNewsPost(updated, { userId: session.user.id, canModerate: permission.canModerate }),
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const access = await loadPostForViewer(id, session.user.id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const { post, permission } = access;
  if (post.userId !== session.user.id && !permission.canModerate) {
    return NextResponse.json({ error: "Удалить пост может автор или модератор" }, { status: 403 });
  }

  /* Комментарии удаляются ЯВНО и первыми. Связь threadId настроена на
     SetNull: удали мы один пост, и все его комментарии превратились бы в
     самостоятельные сообщения без ветки — то есть всплыли бы в ленте как
     отдельные посты без заголовка. */
  await prisma.message.deleteMany({ where: { threadId: post.id } });
  await prisma.message.delete({ where: { id: post.id } });

  /* Уведомление о посте, которого больше нет, хуже отсутствия уведомления:
     человек идёт по ссылке и не находит ничего, а запись продолжает висеть. */
  await deleteSubjectNotifications("news_post", post.id);

  return NextResponse.json({ ok: true });
}
