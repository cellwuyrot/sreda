"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { renderContent, type RenderOptions } from "@/components/connect/messageFormat";
import { MAX_ASSET_BYTES, WORKSPACE_ASSET_TYPES } from "@/lib/workspaceAssets";
import { downscaleForChat } from "@/lib/clientImageResize"; // FIX-NOSHARP
import {
  MAX_POST_TITLE,
  applyFormat,
  clearDraft,
  publishAtFromInputs,
  publishAtToInputs,
  readDraft,
  titleRemaining,
  validatePost,
  writeDraft,
  type PostAttachment,
  type PostDraft,
  type PostFormat,
} from "@/lib/postDraft";
import { useMobile } from "@/hooks/useMobile";
import { useHistoryLayer } from "@/components/connect/hooks/useMobileHistoryStack";
import { AttachmentIcon, ClockIcon, XIcon } from "@/components/ui/ConnectIcons";
import { ImageIcon, LinkIcon, TrashIcon } from "@/components/ui/ConnectIconsExtra";
import InfoTooltip from "@/components/ui/InfoTooltip";
import { parseNewsAttachments, safeMediaUrl } from "./types";
/* FIX-FORMATS: четвёртое место со своим списком — теперь общий. */
import { CHAT_ATTACHMENT_ACCEPT } from "@/lib/attachmentTypes";

/**
 * NEWSPOST: редактор поста новостного канала.
 *
 * ── Почему это отдельный экран, а не строка ввода ───────────────────────────
 *
 * Пост в новостях и реплика в чате — разные жанры. Реплику пишут в две строки и
 * отправляют не глядя; пост читает вся община, у него есть заголовок, обложка и
 * членение внутри текста, и его переписывают по три раза. В строке ввода чата
 * такое не пишут: поле высотой в сто двадцать пикселей не даёт увидеть текст
 * целиком, а увидеть его целиком — единственный способ заметить, что второй
 * абзац повторяет первый. Поэтому редактор занимает экран, а на телефоне —
 * весь экран целиком.
 *
 * ── Почему разметка, а не WYSIWYG ───────────────────────────────────────────
 *
 * Кнопки панели вставляют в текст ту же разметку, которую можно набрать руками
 * (см. components/connect/messageFormat). Редактор «как на бумаге» потребовал бы
 * второго представления текста — дерева узлов вместо строки, — и тогда лента,
 * поиск, уведомления и мобильная оболочка получали бы разные версии одного
 * поста. Здесь текст всегда одна строка, а предпросмотр рисуется ТОЙ ЖЕ
 * функцией, что и лента: расхождение между «как выглядит здесь» и «как увидят»
 * технически невозможно.
 *
 * ── Черновик ────────────────────────────────────────────────────────────────
 *
 * Набранное дублируется в localStorage (см. lib/postDraft): единственная причина,
 * по которой перестают писать длинные посты, — один раз потерянный текст.
 * У существующего поста черновика нет: он уже сохранён на сервере, а общий с
 * созданием ключ означал бы, что правка чужого поста подменяет собой начатый
 * свой.
 */

/** Обложка — только картинка: PDF в шапке ленты показать нечем. */
const COVER_TYPES = Object.keys(WORKSPACE_ASSET_TYPES).filter((type) => type.startsWith("image/"));

/**
 * Существующий пост: с ним компонент работает как редактор, а не как создание.
 *
 * Поля намеренно шире, чем нужно редактору: сюда должен без переделки заходить
 * NewsPost из ленты, где вложения — `unknown[]` (их когда-то записал другой
 * клиент), а время публикации приходит строкой ISO. Приведение к пригодному
 * виду — ниже, одно на оба случая.
 */
export interface NewsComposerPost {
  id: string;
  title?: string | null;
  content?: string | null;
  cover?: string | null;
  attachments?: unknown[] | null;
  commentsClosed?: boolean;
  publishAt?: string | number | null;
}

/** Кнопки панели показывают ту разметку, которую вставляют, — кроме ссылки. */
const FORMAT_BUTTONS: { id: PostFormat; label: string; title: string; className: string }[] = [
  { id: "bold", label: "B", title: "Жирный", className: "font-bold" },
  { id: "italic", label: "I", title: "Курсив", className: "italic" },
  { id: "heading", label: "##", title: "Подзаголовок", className: "font-semibold" },
  { id: "quote", label: "»", title: "Цитата", className: "" },
  { id: "list", label: "•", title: "Список", className: "" },
  { id: "code", label: "</>", title: "Код", className: "font-mono" },
  /* POSTTABLE: таблица стоит последней — её вставляют реже остального, а занимает
     кнопка больше места. Подсказка говорит главное: выделенный текст станет
     таблицей сам, без ручной расстановки вертикальных черт. */
  { id: "table", label: "▦", title: "Таблица — или выделите строки с табуляцией или точкой с запятой", className: "" },
];

/**
 * Кнопка панели разметки.
 *
 * На телефоне цель вырастает до 44 точек. При px-2 py-1 это квадратик стороной
 * около двадцати пяти — меньше подушечки пальца, и соседние «B», «I», «##» шли
 * подряд без просвета: промах вставлял в текст не ту разметку, а заметно это
 * становилось только на вкладке «Как увидят». Панель форматирования — главный
 * инструмент редактора, мимо неё в посте не напишешь ни заголовка, ни списка.
 */
const TOOL_BUTTON =
  "inline-flex items-center justify-center px-2 py-1 text-xs max-md:min-h-[44px] max-md:min-w-[44px] max-md:text-sm text-neutral-600 dark:text-neutral-300 hover:text-violet-600 dark:hover:text-cyan-400 hover:bg-violet-50 dark:hover:bg-white/10 rounded transition-colors";

function parsePublishAt(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value) {
    const at = new Date(value).getTime();
    if (Number.isFinite(at)) return at;
  }
  return null;
}

export default function NewsComposer({
  channelId,
  post,
  renderOptions,
  onClose,
  onSaved,
}: {
  channelId: string;
  /** Существующий пост — тогда это правка (PATCH), а не создание. */
  post?: NewsComposerPost | null;
  /** Теги и эмодзи сообщества — те же, что у ленты, иначе предпросмотр соврёт. */
  renderOptions?: RenderOptions;
  onClose: () => void;
  onSaved?: (saved: unknown) => void;
}) {
  /* Идентификатор, а не сам объект: он строка, поэтому не меняется от каждой
     перерисовки родителя и годится в зависимости эффектов. Смена поста на другой
     подразумевает пересоздание компонента (key), а не подмену пропа. */
  const editingId = post?.id ?? null;

  const [title, setTitle] = useState(() => post?.title ?? "");
  const [content, setContent] = useState(() => post?.content ?? "");
  const [cover, setCover] = useState<string | null>(() => safeMediaUrl(post?.cover));
  /* Разбор — общий с лентой (см. ./types): вложение без пригодного адреса
     показывать нечем, а строка-заглушка в списке файлов читается как поломка. */
  const [attachments, setAttachments] = useState<PostAttachment[]>(() => parseNewsAttachments(post?.attachments));
  const [commentsClosed, setCommentsClosed] = useState(() => post?.commentsClosed === true);

  const initialPublish = publishAtToInputs(parsePublishAt(post?.publishAt));
  const [publishDate, setPublishDate] = useState(initialPublish.date);
  const [publishTime, setPublishTime] = useState(initialPublish.time);
  const [showSchedule, setShowSchedule] = useState(initialPublish.date !== "");

  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Черновик восстановлен (или решено, что восстанавливать нечего). */
  const [ready, setReady] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** Последнее состояние черновика — нужно только эффекту размонтирования. */
  const latestRef = useRef<PostDraft | null>(null);
  /** Пост отправлен: черновик уже не нужен и записывать его обратно нельзя. */
  const sentRef = useRef(false);

  /* Восстановление черновика. Отдельным эффектом и с флагом `ready`, потому что
     сохранение (ниже) обязано ждать: сработай оно первым, пустое начальное
     состояние затёрло бы в хранилище именно то, что мы собирались вернуть. */
  useEffect(() => {
    if (editingId) {
      setReady(true);
      return;
    }
    const saved = readDraft(channelId);
    if (saved) {
      setTitle(saved.title);
      setContent(saved.content);
      setCover(saved.cover);
      setAttachments(saved.attachments);
      setCommentsClosed(saved.commentsClosed);
      const at = publishAtToInputs(saved.publishAt);
      setPublishDate(at.date);
      setPublishTime(at.time);
      setShowSchedule(at.date !== "");
    }
    setReady(true);
  }, [channelId, editingId]);

  /* Сохранение с задержкой: писать в localStorage на каждую букву — это разбор и
     сборка JSON в потоке ввода, и на длинном посте набор начинает подтормаживать.
     Отмена таймера при следующем изменении и есть вся «дребезгозащита». */
  useEffect(() => {
    if (!ready || editingId) return;
    const draft: PostDraft = {
      title,
      content,
      cover,
      attachments,
      commentsClosed,
      publishAt: publishAtFromInputs(publishDate, publishTime),
    };
    latestRef.current = draft;
    const timer = setTimeout(() => writeDraft(channelId, draft), 400);
    return () => clearTimeout(timer);
  }, [ready, editingId, channelId, title, content, cover, attachments, commentsClosed, publishDate, publishTime]);

  /* Закрытие редактора отменяет отложенную запись, и последние набранные буквы
     пропали бы вместе с ней — а закрывают его как раз в спешке. Поэтому на
     размонтировании черновик дописывается сразу. После успешной отправки — нет:
     иначе он воскрес бы поверх только что очищенного. */
  useEffect(() => {
    return () => {
      if (editingId || sentRef.current) return;
      const draft = latestRef.current;
      if (draft) writeDraft(channelId, draft);
    };
  }, [channelId, editingId]);

  /* Escape закрывает редактор. Терять при этом нечего — черновик уже записан. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  /* На телефоне Escape нажимать нечем — там «назад» это системная кнопка или
     жест от края экрана, и оболочка под Android отдаёт их WebView как шаг по
     истории. Редактор развёрнут во весь экран поверх всего, но для истории его
     не существовало: нажатие уходило в стек мессенджера и закрывало сразу весь
     канал. Человек, набиравший пост, одним привычным движением оказывался в
     списке сообществ — с крестиком в углу как единственным правильным выходом,
     до которого ещё надо догадаться.

     Регистрируем себя слоем, как это делают открытая беседа в личных
     сообщениях и выдвижная панель каналов: «назад» закрывает редактор и
     возвращает туда, откуда он открыт. Набранное при этом не пропадает —
     черновик дописывается на размонтировании (эффект выше). */
  const isMobileViewport = useMobile();
  useHistoryLayer(isMobileViewport, onClose, "news-composer");

  /* ── Разметка ── */

  const format = useCallback(
    (kind: PostFormat) => {
      const area = textareaRef.current;
      const start = area ? area.selectionStart : content.length;
      const end = area ? area.selectionEnd : start;
      const next = applyFormat(content, start, end, kind);
      setContent(next.text);
      /* Курсор ставится после перерисовки: до неё в поле ещё старый текст, и
         выделение легло бы по прежним координатам. */
      requestAnimationFrame(() => {
        if (!area) return;
        area.focus();
        area.selectionStart = next.selectionStart;
        area.selectionEnd = next.selectionEnd;
      });
    },
    [content],
  );

  /* ── Файлы ── */

  const uploadCover = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    /* Тип и размер проверяются до отправки. Тот же отказ придёт и с сервера, но
       уже после того, как двенадцать мегабайт уедут по мобильной сети. */
    if (!COVER_TYPES.includes(file.type)) {
      setError("Обложка — картинка: PNG, JPEG, WebP, GIF или SVG");
      return;
    }
    if (file.size > MAX_ASSET_BYTES) {
      setError("Файл больше 12 МБ");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      // FIX-NOSHARP: обложку уменьшает браузер.
      body.append("file", await downscaleForChat(file));
      body.append("channelId", channelId);
      const res = await fetch("/api/workspace/upload", { method: "POST", body });
      const data: { url?: string; error?: string } | null = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        setError(data?.error ?? "Не удалось загрузить обложку");
        return;
      }
      setCover(data.url);
    } catch {
      setError("Не удалось загрузить обложку — проверьте соединение");
    } finally {
      setBusy(false);
    }
  };

  const uploadFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length === 0) return;

    setBusy(true);
    setError(null);
    try {
      const added: PostAttachment[] = [];
      for (const file of files) {
        const body = new FormData();
        // FIX-NOSHARP: материал новости уменьшает браузер.
        body.append("file", await downscaleForChat(file));
        body.append("channelId", channelId);
        const res = await fetch("/api/messages/upload", { method: "POST", body });
        const data: (PostAttachment & { error?: string }) | null = await res.json().catch(() => null);
        if (!res.ok || !data?.url) {
          setError(data?.error ?? `Не удалось загрузить «${file.name}»`);
          continue;
        }
        added.push(data);
      }
      if (added.length > 0) setAttachments((prev) => [...prev, ...added]);
    } catch {
      setError("Не удалось загрузить вложение — проверьте соединение");
    } finally {
      setBusy(false);
    }
  };

  /* ── Отправка ── */

  const submit = async (mode: "draft" | "now" | "later") => {
    const publishAt = mode === "later" ? publishAtFromInputs(publishDate, publishTime) : null;
    if (mode === "later" && publishAt === null) {
      setError("Выберите дату и время публикации");
      return;
    }

    const check = validatePost(
      { title, content, cover, attachments, commentsClosed, publishAt, draft: mode === "draft" },
      Date.now(),
    );
    if (!check.ok) {
      setError(check.error);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(editingId ? `/api/posts/${editingId}` : `/api/channels/${channelId}/posts`, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(check.payload),
      });
      const data: { error?: string } | null = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Не удалось сохранить пост");
        return;
      }
      sentRef.current = true;
      if (!editingId) clearDraft(channelId);
      onSaved?.(data);
      onClose();
    } catch {
      setError("Не удалось сохранить пост — проверьте соединение");
    } finally {
      setBusy(false);
    }
  };

  const left = titleRemaining(title);

  return (
    /* Высота берётся из --tz-app-h, а не из inset-0.
       Редактор — единственный экран новостей, у которого снизу закреплена
       панель с «Опубликовать», и именно она страдала: `bottom: 0` у fixed
       считается от layout viewport, а он в Android WebView при поднятой
       клавиатуре не пересчитывается (dvh там же может быть не поддержан). Панель
       уезжала под клавиатуру, и опубликовать набранный пост было нечем — надо
       было сначала догадаться убрать клавиатуру. --tz-app-h ведёт от
       window.innerHeight и обновляется по resize/visualViewport (см. layout.tsx),
       поэтому каркас редактора живёт вместе с клавиатурой. Тот же приём у
       каркаса мессенджера (.cn-main) и у рабочей среды (WorkspaceCanvas). */
    <div
      className="fixed inset-x-0 top-0 z-[80] flex flex-col bg-[var(--cn-main)]"
      style={{ height: "var(--tz-app-h, 100dvh)" }}
    >
      {/* Шапка. Отступ сверху по безопасной зоне: в отличие от экрана поста,
          который разворачивается внутри ленты, редактор действительно стоит у
          верхнего края окна. Страница объявлена viewport-fit=cover (layout.tsx),
          то есть содержимое заходит под системную строку, и без этого отступа
          название «Новый пост», вкладки и крестик закрытия оказывались под
          часами и значком батареи — крестик становился физически ненажимаемым.
          Значение то же, что у шапки списка сообществ (MobileGroupList). */}
      <div
        className="flex items-center gap-2 border-b border-[var(--cn-border)] px-3 py-2.5 sm:px-4"
        style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top, 0px))" }}
      >
        <div className="min-w-0 flex-1 text-sm font-semibold text-neutral-900 dark:text-white">
          {editingId ? "Правка поста" : "Новый пост"}
        </div>
        {/* Две вкладки, а не «показать предпросмотр рядом»: на телефоне колонки
            рядом не помещаются, а два разных поведения на разных ширинах — два
            разных экрана, которые расходятся при первой же правке. */}
        <div className="flex items-center rounded-lg border border-[var(--cn-border)] p-0.5">
          {[
            { id: false, label: "Текст" },
            { id: true, label: "Как увидят" },
          ].map((tab) => (
            <button
              key={tab.label}
              type="button"
              onClick={() => setPreview(tab.id)}
              /* На телефоне вкладки дорастают до 44 точек: при px-2.5 py-1 полоска
                 «Текст / Как увидят» была высотой в палец-с-четвертью и
                 переключалась через раз — попасть между двумя соседними целями
                 шириной в сорок точек пальцем нельзя. */
              className={`inline-flex items-center justify-center rounded-md px-2.5 py-1 text-xs transition-colors max-md:min-h-[44px] max-md:px-4 ${
                preview === tab.id
                  ? "bg-violet-50 text-violet-600 dark:bg-white/10 dark:text-cyan-400"
                  : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          title="Закрыть"
          className="inline-flex items-center justify-center rounded-lg p-1.5 text-neutral-400 transition-colors hover:text-neutral-900 max-md:min-h-[44px] max-md:min-w-[44px] dark:hover:text-white"
        >
          <XIcon size={16} style={{ color: "inherit" }} />
        </button>
      </div>

      {/* Тело. overscroll-contain — как в ленте и на экране поста: без него
          прокрутка, доехавшая до края редактора, продолжалась в самом WebView и
          срабатывало его обновление страницы. Для набранного поста это значит
          перезагрузку прямо посреди правки. */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-4">
          {preview ? (
            <article>
              {cover && (
                /* eslint-disable-next-line @next/next/no-img-element -- оптимизация картинок в проекте отключена намеренно */
                <img src={cover} alt="" className="mb-4 w-full rounded-xl object-cover" />
              )}
              {title.trim() && (
                <h1 className="mb-3 text-xl font-semibold leading-tight text-neutral-900 dark:text-white">{title}</h1>
              )}
              {/* Та же функция, что и в ленте: предпросмотр не может разойтись с ней. */}
              <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-800 dark:text-gray-200">
                {renderContent(content, renderOptions)}
              </div>
              {attachments.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {attachments.map((file) => (
                    <span
                      key={file.url}
                      className="max-w-[220px] truncate rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"
                    >
                      {file.name}
                    </span>
                  ))}
                </div>
              )}
              {commentsClosed && <div className="mt-4 text-xs text-neutral-400">Комментарии закрыты</div>}
            </article>
          ) : (
            <>
              {/* Заголовок */}
              <div className="relative">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={MAX_POST_TITLE}
                  placeholder="Заголовок"
                  className="input-field !py-2.5 !text-base font-semibold"
                />
                {/* Счётчик появляется только у предела: постоянный висел бы перед
                    глазами всё время, пока в нём нет нужды. */}
                {left !== null && (
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] tabular-nums text-neutral-400">
                    {left}
                  </span>
                )}
              </div>

              {/* Обложка */}
              <div className="mt-3">
                {cover ? (
                  <div className="relative overflow-hidden rounded-xl border border-[var(--cn-border)]">
                    {/* eslint-disable-next-line @next/next/no-img-element -- оптимизация картинок в проекте отключена намеренно */}
                    <img src={cover} alt="Обложка поста" className="block max-h-64 w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setCover(null)}
                      aria-label="Убрать обложку"
                      title="Убрать обложку"
                      /* Единственный способ снять уже загруженную обложку —
                         и цель в 26 точек поверх самой картинки: промах ничего
                         не делал, а попытки повторялись, пока человек не решал,
                         что обложка не убирается вовсе. */
                      className="absolute right-2 top-2 inline-flex items-center justify-center rounded-lg bg-black/50 p-1.5 text-white transition-colors hover:text-red-400 max-md:min-h-[44px] max-md:min-w-[44px]"
                    >
                      <TrashIcon size={14} style={{ color: "inherit" }} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => coverInputRef.current?.click()}
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-xl border border-dashed border-[var(--cn-border)] px-3 py-2 text-xs text-neutral-500 transition-colors hover:border-violet-400 hover:text-violet-600 disabled:opacity-50 max-md:min-h-[44px] dark:text-neutral-400 dark:hover:border-cyan-400 dark:hover:text-cyan-400"
                  >
                    <ImageIcon size={16} style={{ color: "inherit" }} />
                    Обложка
                  </button>
                )}
                <input
                  ref={coverInputRef}
                  type="file"
                  className="hidden"
                  accept={COVER_TYPES.join(",")}
                  onChange={uploadCover}
                />
              </div>

              {/* Панель форматирования */}
              <div className="mt-3 flex flex-wrap items-center gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-2 dark:border-white/10 dark:bg-white/5">
                {FORMAT_BUTTONS.map((button) => (
                  <button
                    key={button.id}
                    type="button"
                    onClick={() => format(button.id)}
                    title={button.title}
                    aria-label={button.title}
                    className={`${TOOL_BUTTON} ${button.className}`}
                  >
                    {button.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => format("link")}
                  title="Ссылка"
                  aria-label="Ссылка"
                  className={`${TOOL_BUTTON} inline-flex items-center`}
                >
                  <LinkIcon size={14} style={{ color: "inherit" }} />
                </button>
                <InfoTooltip text="Кнопки вставляют разметку в текст. Повторное нажатие снимает её. Как это будет выглядеть — на вкладке «Как увидят»." />
              </div>

              {/* Текст */}
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Текст поста"
                rows={14}
                /* Четырнадцать строк — мера для большого экрана: там поле на
                   треть окна и есть ради того, чтобы видеть пост целиком. На
                   телефоне те же четырнадцать строк дают почти четыреста точек,
                   и с поднятой клавиатурой поле оказывалось выше видимой части
                   тела редактора: панель разметки уезжала за верхний край, а
                   заголовок и обложка — тем более. Здесь поле ниже видимой
                   области, панель остаётся под рукой, а длинный текст листается
                   внутри самого поля.
                   resize-y на телефоне снимаем: уголок растягивания тянется
                   мышью, а пальцем он только перехватывает прокрутку. */
                className="input-field mt-2 resize-y font-normal leading-relaxed max-md:h-64 max-md:resize-none"
              />

              {/* Вложения */}
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-xl border border-[var(--cn-border)] px-3 py-2 text-xs text-neutral-500 transition-colors hover:text-violet-600 disabled:opacity-50 max-md:min-h-[44px] dark:text-neutral-400 dark:hover:text-cyan-400"
                >
                  <AttachmentIcon size={16} style={{ color: "inherit" }} />
                  Вложения
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept={CHAT_ATTACHMENT_ACCEPT}
                  onChange={uploadFiles}
                />
                {attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {attachments.map((file) => (
                      <div
                        key={file.url}
                        /* На телефоне плашка дорастает до 44 точек — ровно
                           затем, чтобы в неё поместился крестик такого же
                           размера (см. ниже). max-w-full: на узком экране предел
                           в 220 точек обрезал имя файла вдвое раньше, чем
                           кончалась строка, и два разных вложения выглядели
                           одинаково — «Отчёт за…» и «Отчёт за…». */
                        className="flex max-w-[220px] items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600 max-md:min-h-[44px] max-md:max-w-full dark:border-white/10 dark:bg-white/5 dark:text-gray-300"
                      >
                        <span className="truncate">{file.name}</span>
                        <button
                          type="button"
                          onClick={() => setAttachments((prev) => prev.filter((item) => item.url !== file.url))}
                          aria-label={`Удалить вложение «${file.name}»`}
                          /* Отрицательный отступ справа: цель в 44 точки
                             вписывается в плашку, не раздвигая её и не съедая
                             место у имени файла. */
                          className="inline-flex items-center justify-center text-neutral-400 transition-colors hover:text-red-500 max-md:-mr-1.5 max-md:min-h-[44px] max-md:min-w-[44px]"
                        >
                          <XIcon size={13} style={{ color: "inherit" }} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Комментарии */}
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={commentsClosed}
                  onClick={() => setCommentsClosed((v) => !v)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    commentsClosed ? "bg-green-500" : "bg-neutral-300 dark:bg-neutral-600"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      commentsClosed ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>
                <span className="text-sm text-neutral-700 dark:text-gray-300">Комментарии закрыты</span>
                <InfoTooltip text="Пост появится в ленте без обсуждения. Уже написанные комментарии не удаляются — их просто не видно, пока обсуждение закрыто." />
              </div>

              {/* Отложенная публикация */}
              {showSchedule && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--cn-border)] bg-[var(--cn-accent-dim)] p-2.5">
                  <ClockIcon size={14} tone="muted" />
                  {/* Поля даты и времени на телефоне открывают системные
                      выбиралки, и нажимать в них приходится точно. При !py-1
                      это полоски высотой около двадцати пяти точек — вдвое ниже
                      нормы; min-w-0 не даёт паре «дата + время» вылезти за край
                      узкого экрана, ведь ширину такому полю Android назначает
                      сам, по своему формату. */}
                  <input
                    type="date"
                    value={publishDate}
                    onChange={(e) => setPublishDate(e.target.value)}
                    className="input-field !w-auto min-w-0 !px-2 !py-1 text-xs max-md:min-h-[44px]"
                  />
                  <input
                    type="time"
                    value={publishTime}
                    onChange={(e) => setPublishTime(e.target.value)}
                    className="input-field !w-auto min-w-0 !px-2 !py-1 text-xs max-md:min-h-[44px]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setShowSchedule(false);
                      setPublishDate("");
                      setPublishTime("");
                    }}
                    className="inline-flex items-center justify-center text-xs text-neutral-400 transition-colors hover:text-neutral-700 max-md:min-h-[44px] max-md:px-2 dark:hover:text-neutral-200"
                  >
                    Отменить
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Подвал.
          Отступ снизу задаётся здесь, а не классом tz-safe-bottom: тот ставит
          padding-bottom ровно в env(safe-area-inset-bottom) и тем самым гасит
          собственный py-2.5. На телефоне с экранными кнопками (а не полосой
          жестов) безопасная зона нулевая, и «Опубликовать» прилипала вплотную к
          нижнему краю окна — палец задевал край экрана раньше кнопки. max()
          берёт большее из двух: полосу жестов там, где она есть, и обычный
          отступ там, где её нет. Тот же приём у строки комментария на экране
          поста. */}
      <div
        className="border-t border-[var(--cn-border)] bg-[var(--cn-main)] px-3 py-2.5 sm:px-4"
        style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2">
          {error && <div className="w-full text-xs text-red-500">{error}</div>}
          {/* Раскладка подвала на телефоне.
              Три кнопки подряд в строку 360 точек не помещаются, а распорка
              (flex-1 ниже) на переносе съедала остаток первой строки и сбивала
              «Опубликовать» на вторую — к левому краю, вплотную под «Сохранить
              черновик» и ничем от неё не отличаясь по месту. Главное действие
              редактора выглядело как третья одинаковая кнопка в куче.
              Теперь на узком экране два второстепенных действия делят первую
              строку поровну, а «Опубликовать» занимает всю вторую: промахнуться
              мимо неё нельзя и спутать её с соседями тоже. На большом экране
              всё как было — одна строка и распорка. */}
          <button
            type="button"
            onClick={() => submit("draft")}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-xl border border-[var(--cn-border)] px-3 py-2 text-xs text-neutral-600 transition-colors hover:text-violet-600 disabled:opacity-50 max-md:min-h-[44px] max-md:flex-1 dark:text-neutral-300 dark:hover:text-cyan-400"
          >
            Сохранить черновик
          </button>
          {/* Кнопка не отправляет сразу: сначала нужно выбрать время, иначе
              «опубликовать позже» ничем не отличалось бы от «опубликовать». */}
          <button
            type="button"
            onClick={() => {
              if (showSchedule) {
                void submit("later");
                return;
              }
              setShowSchedule(true);
              // Поля даты живут на вкладке текста — иначе нажатие ничего не покажет.
              setPreview(false);
            }}
            disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--cn-border)] px-3 py-2 text-xs text-neutral-600 transition-colors hover:text-violet-600 disabled:opacity-50 max-md:min-h-[44px] max-md:flex-1 dark:text-neutral-300 dark:hover:text-cyan-400"
          >
            <ClockIcon size={13} style={{ color: "inherit" }} />
            Опубликовать позже
          </button>
          <div className="flex-1 max-md:hidden" />
          <button
            type="button"
            onClick={() => submit("now")}
            disabled={busy}
            className="btn-primary !px-4 !py-2 !text-sm disabled:opacity-50 max-md:!min-h-[44px] max-md:w-full"
          >
            {editingId ? "Сохранить" : "Опубликовать"}
          </button>
        </div>
      </div>
    </div>
  );
}
