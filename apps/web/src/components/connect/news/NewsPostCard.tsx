"use client";

/**
 * NEWS: карточка поста в ленте.
 *
 * ── Почему вся карточка — одна кнопка ───────────────────────────────────────
 *
 * Оболочка проекта под Android — это WebView, то есть палец, а не курсор.
 * Карточка с отдельными мелкими действиями (открыть, автор, реакция) на телефоне
 * превращается в лотерею: промах по 20-пиксельной ссылке уводит не туда, откуда
 * ещё надо возвращаться. Поэтому нажимается вся карточка целиком и ведёт ровно
 * в одно место — на экран поста. Всё остальное (закрепить, реакции, автор)
 * живёт там, где есть место под нормальные цели нажатия.
 *
 * По той же причине здесь нет ни одного действия «по наведению»: наведения на
 * телефоне не существует, и такое действие для половины людей просто не
 * существовало бы.
 */

import { useState } from "react";
import GlowAvatar from "@/components/ui/GlowAvatar";
import { TriozEmoji } from "@/components/ui/TriozEmoji";
import { ChatIcon, ClockIcon, PinIcon, UsersIcon } from "@/components/ui/ConnectIcons";
import {
  formatPostDate,
  formatPostDateTime,
  formatViews,
  hasMoreToRead,
  postCover,
  postExcerpt,
  postMark,
  type NewsPost,
  type NewsReaction,
} from "./types";

/**
 * Реакции — только счёт, без возможности поставить свою.
 *
 * Договор с сервером даёт по реакциям лишь итог (`emoji`, `count`, `mine`) и не
 * даёт ручки, которой её переключают. Рисовать кнопку, которая ничего не шлёт,
 * хуже, чем не рисовать её вовсе: человек нажимает, счётчик не меняется, и это
 * читается как поломка. Появится маршрут — здесь добавится onClick.
 */
export function NewsReactions({ reactions, size = 16 }: { reactions: NewsReaction[]; size?: number }) {
  if (!reactions || reactions.length === 0) return null;
  return (
    <div className="tz-reaction-row">
      {reactions.map((reaction) => (
        <span
          key={reaction.emoji}
          /* FIX-EMOJI: третье место с той же пилюлей. Выравнивание общее
             (tz-reaction-pill), чтобы лента новостей и чат выглядели одинаково. */
          className={`tz-reaction-pill rounded-full border px-2 py-1 text-[12px] ${
            reaction.mine
              ? "border-violet-200 bg-violet-50 text-accent dark:border-cyan-400/30 dark:bg-cyan-400/10"
              : "border-[var(--cn-border)] bg-neutral-50 text-neutral-500 dark:bg-white/5 dark:text-neutral-400"
          }`}
        >
          <TriozEmoji emoji={reaction.emoji} size={size} />
          <span className="tz-reaction-count">{reaction.count}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * Метка «черновик» или «выйдет тогда-то».
 *
 * Такой пост сервер отдаёт только автору, но сам автор без метки не отличит его
 * от опубликованного: карточка выглядит один в один. Дальше он ждёт откликов на
 * запись, которой никто не видел.
 */
export function PostMarks({ post, showPinned = true }: { post: NewsPost; showPinned?: boolean }) {
  const mark = postMark(post);
  if (!mark && !(showPinned && post.pinned)) return null;
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
      {showPinned && post.pinned && (
        <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-accent dark:bg-cyan-400/10">
          <PinIcon size={12} className="!text-violet-500 dark:!text-cyan-400" />
          Закреплено
        </span>
      )}
      {mark === "draft" && (
        <span className="inline-flex items-center rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-500 dark:bg-white/10 dark:text-neutral-300">
          Черновик
        </span>
      )}
      {mark === "scheduled" && post.publishAt && (
        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-300">
          <ClockIcon size={12} className="!text-amber-600 dark:!text-amber-300" />
          Выйдет {formatPostDateTime(post.publishAt)}
        </span>
      )}
    </div>
  );
}

export default function NewsPostCard({
  post,
  onOpen,
}: {
  post: NewsPost;
  onOpen: (post: NewsPost) => void;
}) {
  /* Битая обложка убирается целиком, а не показывается значком «нет картинки»:
     файл мог не пережить переезд хранилища, и колонка серых прямоугольников
     выглядит как сломанная лента, хотя сами новости на месте. */
  const [coverFailed, setCoverFailed] = useState(false);

  const cover = postCover(post);
  const excerpt = postExcerpt(post.content);

  return (
    <article className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-white/10 dark:bg-white/5">
      <button
        type="button"
        onClick={() => onOpen(post)}
        className="block w-full text-left transition-colors active:bg-neutral-50 dark:active:bg-white/5"
      >
        {cover && !coverFailed && (
          /* Оптимизация картинок в проекте отключена намеренно (см. next.config),
             поэтому обычный <img>. Ленивая загрузка обязательна: в ленте на
             двадцать записей это двадцать обложек, и без неё телефон тянет их
             все сразу — по мобильной сети первый экран ждёт остальные. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setCoverFailed(true)}
            className="aspect-[16/9] w-full bg-neutral-100 object-cover dark:bg-white/5"
            draggable={false}
          />
        )}

        <div className="p-3.5 sm:p-4">
          <PostMarks post={post} />

          <h3 className="line-clamp-2 break-words text-[15px] font-semibold leading-snug text-neutral-900 dark:text-white sm:text-base">
            {post.title}
          </h3>

          {excerpt && (
            <p className="mt-1.5 line-clamp-3 break-words text-[13.5px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              {excerpt}
            </p>
          )}

          {hasMoreToRead(post.content) && (
            /* Не ссылка и не вложенная кнопка: внутри кнопки-карточки они
               недопустимы по разметке и перехватывали бы касание. */
            <span className="mt-1.5 inline-block text-[13px] font-medium text-accent">Читать далее</span>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12px] text-neutral-400">
            <span className="flex min-w-0 items-center gap-1.5">
              {/* GlowAvatar требует роль, а в договоре новостей ролей нет —
                  на отрисовку она не влияет, важны имя и картинка. */}
              <GlowAvatar user={{ ...post.author, role: "MEMBER" }} size={22} />
              <span className="max-w-[10rem] truncate text-neutral-500 dark:text-neutral-300">{post.author.name}</span>
            </span>
            <span className="whitespace-nowrap">{formatPostDate(post.createdAt)}</span>
            {post.views > 0 && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap" title="Просмотры">
                {/* В строке карточки просмотры сокращённые: на узком экране
                    «1 234 567» вытесняет из строки дату и число комментариев. */}
                <UsersIcon size={14} />
                {formatViews(post.views)}
              </span>
            )}
            {post.commentCount > 0 && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap" title="Комментарии">
                <ChatIcon size={14} />
                {post.commentCount}
              </span>
            )}
          </div>

          {post.reactions.length > 0 && (
            <div className="mt-2">
              <NewsReactions reactions={post.reactions} />
            </div>
          )}
        </div>
      </button>
    </article>
  );
}
