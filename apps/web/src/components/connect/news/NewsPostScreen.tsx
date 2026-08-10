"use client";

/**
 * NEWS: экран одного поста — обложка, текст, вложения, комментарии.
 *
 * ── Почему это экран, а не окно ─────────────────────────────────────────────
 *
 * Модальное окно на телефоне — это половина экрана под пост и половина под
 * затемнение, плюс закрытие «мимо окна», которое пальцем срабатывает случайно.
 * Здесь вместо окна честный экран во всю высоту с кнопкой «назад»: аппаратная
 * кнопка Android и жест возврата ведут себя предсказуемо, а лента под ним не
 * размонтируется и не теряет место прокрутки.
 *
 * ── Что здесь считается сделанным ───────────────────────────────────────────
 *
 * Просмотр засчитывается один раз за вкладку (см. counted ниже), комментарии
 * грузятся отдельным запросом, а изменения, которые видны и в ленте (просмотры,
 * число комментариев, закрепление), уезжают наверх через onPostChange — иначе
 * человек вернулся бы к карточке со старыми числами и решил, что не сохранилось.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import GlowAvatar from "@/components/ui/GlowAvatar";
import ImageLightbox from "@/components/ui/ImageLightbox";
/* FIX-IMGMENU: картинки в новостном посте скачиваются тем же меню, что и в чатах. */
import ImageContextMenu, { useImageContextMenu } from "@/components/ui/ImageContextMenu";
import { FileIcon, LockIcon, PinIcon, UsersIcon } from "@/components/ui/ConnectIcons";
import { EditIcon } from "@/components/ui/ConnectIconsExtra";
import { renderContent } from "../messageFormat";
import { NewsReactions, PostMarks } from "./NewsPostCard";
import {
  commentsTitle,
  fileSizeLabel,
  formatPostDate,
  formatPostDateTime,
  parseNewsAttachments,
  postCover,
  type NewsComment,
  type NewsCommentPage,
  type NewsPost,
} from "./types";

/**
 * Посты, просмотр которых уже отправлен в этой вкладке.
 *
 * Живёт вне компонента нарочно. В режиме строгой проверки React монтирует
 * экран дважды, и без этого списка каждое открытие давало бы два просмотра
 * вместо одного; сюда же попадает случай «открыл, вернулся, открыл снова» —
 * счётчик от такого расти не должен.
 */
const counted = new Set<string>();

/** Ограничение высоты поля ввода: дальше растёт прокрутка внутри него. */
const INPUT_MAX_HEIGHT = 140;

export default function NewsPostScreen({
  post,
  onBack,
  onPostChange,
  onEdit,
}: {
  post: NewsPost;
  onBack: () => void;
  /** Правка полей, которые видны и на карточке в ленте. */
  onPostChange?: (id: string, patch: Partial<NewsPost>) => void;
  /**
   * «Править этот пост». Сам редактор экран не открывает: тот занимает всё
   * окно и живёт выше ленты, а отсюда наружу уходит только выбор — иначе
   * экран поста тянул бы за собой редактор со всеми его загрузками файлов.
   * Без обработчика кнопки нет: она вела бы в никуда.
   */
  onEdit?: (post: NewsPost) => void;
}) {
  const [comments, setComments] = useState<NewsComment[]>([]);
  const [commentCursor, setCommentCursor] = useState<string | null>(null);
  const [canComment, setCanComment] = useState(false);
  const [commentsStatus, setCommentsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  /* Одно меню на весь экран поста: и обложка, и вложения в теле поста. */
  const imageMenu = useImageContextMenu();
  const [coverFailed, setCoverFailed] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  /* Обработчик из ленты пересоздаётся при каждом изменении списка. Держи его в
     зависимостях эффекта — и запрос просмотра уходил бы заново на каждую правку
     ленты; поэтому свежая ссылка кладётся в ref (запись в эффекте, не в
     отрисовке), а эффекты зависят только от идентификатора поста. */
  const notifyRef = useRef(onPostChange);
  useEffect(() => {
    notifyRef.current = onPostChange;
  }, [onPostChange]);

  /* Просмотр. Ответ сервера — новое число, а не «+1»: два открытых устройства
     иначе разошлись бы в показаниях. */
  useEffect(() => {
    if (counted.has(post.id)) return;
    counted.add(post.id);
    fetch(`/api/posts/${post.id}/view`, { method: "POST", credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { views?: number } | null) => {
        if (data && typeof data.views === "number") notifyRef.current?.(post.id, { views: data.views });
      })
      .catch(() => {
        /* просмотр не критичен: молча не считаем */
      });
  }, [post.id]);

  /* Комментарии отдельным запросом: они длиннее самого поста и тянуть их вместе
     с лентой значило бы ждать их на каждой карточке, которую никто не открыл. */
  useEffect(() => {
    let alive = true;
    setCommentsStatus("loading");
    setComments([]);
    setCommentCursor(null);
    fetch(`/api/posts/${post.id}/comments`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((page: NewsCommentPage) => {
        if (!alive) return;
        setComments(page.comments ?? []);
        setCanComment(!!page.canComment);
        setCommentCursor(page.nextCursor ?? null);
        setCommentsStatus("ready");
      })
      .catch(() => {
        if (alive) setCommentsStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [post.id]);

  const loadMoreComments = useCallback(() => {
    if (!commentCursor || loadingMore) return;
    setLoadingMore(true);
    fetch(`/api/posts/${post.id}/comments?cursor=${encodeURIComponent(commentCursor)}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((page: NewsCommentPage) => {
        setComments((prev) => {
          const seen = new Set(prev.map((c) => c.id));
          return [...prev, ...(page.comments ?? []).filter((c) => !seen.has(c.id))];
        });
        setCommentCursor(page.nextCursor ?? null);
      })
      .catch(() => {
        /* курсор не сдвигаем — кнопка остаётся, можно нажать ещё раз */
      })
      .finally(() => setLoadingMore(false));
  }, [commentCursor, loadingMore, post.id]);

  const send = useCallback(async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setSendFailed(false);
    try {
      const res = await fetch(`/api/posts/${post.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { comment?: NewsComment };
      const added = data?.comment;
      if (!added) throw new Error("empty");
      /* Тот же комментарий мог приехать и страницей подгрузки — проверяем по
         идентификатору, иначе он двоится, а ключи в списке повторяются. */
      setComments((prev) => (prev.some((c) => c.id === added.id) ? prev : [...prev, added]));
      setDraft("");
      notifyRef.current?.(post.id, { commentCount: post.commentCount + 1 });
      /* Высоту поле набрало само под текст — после отправки её надо вернуть,
         иначе пустое поле остаётся ростом с отправленный комментарий. */
      if (inputRef.current) inputRef.current.style.height = "auto";
    } catch {
      setSendFailed(true);
    } finally {
      setSending(false);
    }
  }, [draft, sending, post.id, post.commentCount]);

  const togglePin = useCallback(async () => {
    if (pinning) return;
    setPinning(true);
    const next = !post.pinned;
    try {
      const res = await fetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pinned: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      /* Порядок в ленте задаёт сервер — лента по этой правке перечитает первую
         страницу сама, здесь достаточно сообщить новое состояние. */
      notifyRef.current?.(post.id, { pinned: next });
    } catch {
      /* состояние не меняем: кнопка осталась в прежнем положении */
    } finally {
      setPinning(false);
    }
  }, [pinning, post.id, post.pinned]);

  const cover = postCover(post);
  const attachments = parseNewsAttachments(post.attachments);
  /* Первая картинка вложений могла стать обложкой — второй раз её не показываем. */
  const rest = attachments.filter((a) => a.url !== cover);
  const images = rest.filter((a) => a.isImage);
  const videos = rest.filter((a) => a.isVideo);
  const files = rest.filter((a) => !a.isImage && !a.isVideo);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--cn-main)]">
      {/* Отступа под системную строку здесь нет намеренно.
          Экран поста разворачивается внутри ленты, а лента живёт под общей
          шапкой канала (MessageArea) — до верхнего края окна отсюда ещё целая
          шапка. env(safe-area-inset-top) же меряет вырез экрана независимо от
          того, где стоит элемент, и на телефоне с чёлкой добавлял здесь, в
          середине экрана, пустую полосу в сорок с лишним точек: заголовок поста
          отрывался от шапки канала и висел в воздухе. Безопасную зону сверху
          закрывает тот, кто действительно стоит у края окна. */}
      <header className="flex flex-shrink-0 items-center gap-1 border-b border-[var(--cn-border)] px-1 py-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="Назад"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-neutral-500 transition-colors active:bg-neutral-100 dark:text-neutral-400 dark:active:bg-white/5"
        >
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-neutral-900 dark:text-white">
          {post.title}
        </h2>
        {/* Правка стоит слева от закрепления: закрепление тут было раньше, и
            менять привычное место у самого края ради новой кнопки — значит
            заставлять промахиваться тех, кто уже привык. */}
        {post.canEdit && onEdit && (
          <button
            type="button"
            onClick={() => onEdit(post)}
            aria-label="Изменить"
            title="Изменить"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-neutral-400 transition-colors active:bg-neutral-100 dark:active:bg-white/5"
          >
            <EditIcon size={20} />
          </button>
        )}
        {post.canEdit && (
          <button
            type="button"
            onClick={togglePin}
            disabled={pinning}
            aria-pressed={post.pinned}
            aria-label={post.pinned ? "Открепить" : "Закрепить"}
            className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl transition-colors active:bg-neutral-100 disabled:opacity-40 dark:active:bg-white/5 ${
              post.pinned ? "text-accent" : "text-neutral-400"
            }`}
          >
            <PinIcon size={20} className={post.pinned ? "!text-violet-500 dark:!text-cyan-400" : undefined} />
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {cover && !coverFailed && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setCoverFailed(true)}
            onClick={() => setLightboxSrc(cover)}
            className="max-h-[52vh] w-full cursor-zoom-in bg-neutral-100 object-cover dark:bg-white/5"
            draggable={false}
            {...imageMenu.bind(cover)}
          />
        )}

        <div className="px-4 pb-6 pt-4">
          <PostMarks post={post} />

          <h1 className="break-words text-xl font-semibold leading-snug text-neutral-900 dark:text-white">
            {post.title}
          </h1>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12.5px] text-neutral-400">
            <span className="flex min-w-0 items-center gap-2">
              <GlowAvatar user={{ ...post.author, role: "MEMBER" }} size={28} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-neutral-700 dark:text-neutral-200">{post.author.name}</span>
                {post.author.username && <span className="block truncate text-[11.5px]">@{post.author.username}</span>}
              </span>
            </span>
            <span className="whitespace-nowrap">{formatPostDate(post.createdAt)}</span>
            {post.editedAt && (
              <span className="whitespace-nowrap" title={`Изменено ${formatPostDateTime(post.editedAt)}`}>
                изменено
              </span>
            )}
            {post.views > 0 && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap" title="Просмотры">
                <UsersIcon size={14} />
                {post.views.toLocaleString("ru-RU")}
              </span>
            )}
          </div>

          {post.content && (
            /* Разметка та же, что в сообщениях (messageFormat): ссылки, выделения,
               упоминания, блоки кода. Своя разбирала бы тот же текст иначе, и один
               и тот же пост, пересланный в чат, выглядел бы по-другому. */
            <div className="mt-4 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-neutral-800 dark:text-neutral-200">
              {renderContent(post.content)}
            </div>
          )}

          {images.length > 0 && (
            <div className="mt-4 space-y-2">
              {images.map((attachment) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={attachment.url}
                  src={attachment.url}
                  alt={attachment.name}
                  loading="lazy"
                  decoding="async"
                  onClick={() => setLightboxSrc(attachment.url)}
                  className="w-full cursor-zoom-in rounded-xl bg-neutral-100 object-cover dark:bg-white/5"
                  draggable={false}
                  {...imageMenu.bind(attachment.url, attachment.name)}
                />
              ))}
            </div>
          )}

          {videos.length > 0 && (
            <div className="mt-4 space-y-2">
              {videos.map((attachment) => (
                /* preload="metadata": по мобильной сети пост с тремя роликами
                   иначе начинал бы качать все три ещё до нажатия «играть». */
                <video
                  key={attachment.url}
                  src={attachment.url}
                  controls
                  preload="metadata"
                  playsInline
                  className="w-full rounded-xl bg-black"
                />
              ))}
            </div>
          )}

          {files.length > 0 && (
            <div className="mt-4 space-y-1.5">
              {files.map((attachment) => (
                <a
                  key={attachment.url}
                  href={attachment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-[44px] items-center gap-2.5 rounded-xl border border-neutral-200 px-3 py-2 transition-colors active:bg-neutral-50 dark:border-white/10 dark:active:bg-white/5"
                >
                  <FileIcon size={18} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-neutral-800 dark:text-neutral-200">{attachment.name}</span>
                    {attachment.size > 0 && (
                      <span className="block text-[11.5px] text-neutral-400">{fileSizeLabel(attachment.size)}</span>
                    )}
                  </span>
                </a>
              ))}
            </div>
          )}

          {post.reactions.length > 0 && (
            <div className="mt-4">
              <NewsReactions reactions={post.reactions} size={18} />
            </div>
          )}
        </div>

        <div className="border-t border-[var(--cn-border)] px-4 py-4">
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-neutral-400">
            {commentsTitle(post.commentCount)}
          </h3>

          {commentsStatus === "loading" && (
            <div className="mt-3 space-y-3" aria-hidden="true">
              {[0, 1].map((row) => (
                <div key={row} className="flex gap-2.5">
                  <div className="h-8 w-8 flex-shrink-0 animate-pulse rounded-full bg-neutral-200 dark:bg-white/10" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-2.5 w-24 animate-pulse rounded bg-neutral-200 dark:bg-white/10" />
                    <div className="h-2.5 w-full animate-pulse rounded bg-neutral-200 dark:bg-white/10" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {commentsStatus === "error" && (
            <p className="mt-3 text-[13px] text-neutral-400">Комментарии не загрузились</p>
          )}

          {commentsStatus === "ready" && comments.length === 0 && (
            <p className="mt-3 text-[13px] text-neutral-400">
              {post.commentsClosed ? "Комментариев не было" : "Комментариев пока нет"}
            </p>
          )}

          {comments.length > 0 && (
            <ul className="mt-3 space-y-3.5">
              {comments.map((comment) => (
                <li key={comment.id} className="flex gap-2.5">
                  <GlowAvatar user={{ ...comment.author, role: "MEMBER" }} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="truncate text-[13px] font-medium text-neutral-800 dark:text-neutral-100">
                        {comment.author.name}
                      </span>
                      <span className="text-[11.5px] text-neutral-400">{formatPostDate(comment.createdAt)}</span>
                    </div>
                    <div className="mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-neutral-700 dark:text-neutral-300">
                      {renderContent(comment.content)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {commentCursor && (
            <button
              type="button"
              onClick={loadMoreComments}
              disabled={loadingMore}
              className="mt-3 min-h-[44px] w-full rounded-xl border border-neutral-200 text-[13px] font-medium text-neutral-500 transition-colors active:bg-neutral-50 disabled:opacity-50 dark:border-white/10 dark:text-neutral-400 dark:active:bg-white/5"
            >
              {loadingMore ? "Загружаем…" : "Показать ещё"}
            </button>
          )}
        </div>
      </div>

      {/* Нижняя полоса рисуется, только если в ней есть что показать.
          У того, кому комментировать нельзя (а обсуждение при этом открыто),
          она раньше выходила пустой: голая черта и отступ под полосу жестов
          съедали у текста поста две сантиметровые строки на экране, где их и
          так мало, — и выглядело это как не догрузившееся поле ввода. */}
      {(post.commentsClosed || canComment) && (
      <div
        className="flex-shrink-0 border-t border-[var(--cn-border)] px-3 py-2"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0px))" }}
      >
        {post.commentsClosed ? (
          <p className="flex items-center justify-center gap-2 py-2 text-[13px] text-neutral-400">
            <LockIcon size={15} />
            Комментарии закрыты
          </p>
        ) : canComment ? (
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={draft}
              rows={1}
              placeholder="Комментарий"
              onChange={(e) => {
                setDraft(e.target.value);
                /* Поле растёт под текст. Высота ставится прямо в узле, а не через
                   состояние: пересчёт на каждую букву дёргал бы весь экран. */
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_HEIGHT)}px`;
              }}
              onKeyDown={(e) => {
                /* Отправка только с Ctrl/Cmd: на телефоне Enter — это перенос
                   строки, и отправка по нему рвала бы комментарий на куски. */
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
              /* На телефоне шрифт поля 16px: при меньшем мобильные браузеры
                 приближают страницу на фокусе, и человек дописывает комментарий
                 в увеличенной вёрстке, из которой сам не выйдет (то же правило
                 в globals.css для .input-field). min-w-0 — чтобы поле ужималось
                 под узкий экран: у textarea своя ширина по cols, и без этого
                 строка ввода вместе с кнопкой отправки вылезала бы за край. */
              className="max-h-[140px] min-h-[44px] min-w-0 flex-1 resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-[14px] text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-violet-400 max-md:text-[16px] dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:border-cyan-400"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!draft.trim() || sending}
              aria-label="Отправить комментарий"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-violet-600 text-white transition-opacity disabled:opacity-40 dark:bg-cyan-500 dark:text-neutral-950"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        ) : null}
        {sendFailed && (
          /* Текст остаётся в поле: набранное не должно пропадать из-за обрыва
             связи — повторить отправку можно той же кнопкой. */
          <p className="mt-1.5 text-[12px] text-red-500">Комментарий не отправился</p>
        )}
      </div>
      )}

      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />

      {imageMenu.menu && (
        <ImageContextMenu
          src={imageMenu.menu.src}
          name={imageMenu.menu.name}
          x={imageMenu.menu.x}
          y={imageMenu.menu.y}
          onClose={imageMenu.close}
          onOpen={() => setLightboxSrc(imageMenu.menu!.src)}
        />
      )}
    </div>
  );
}
