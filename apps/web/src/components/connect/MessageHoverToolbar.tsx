"use client";

/**
 * Hover-тулбар сообщения (TZ.Connect): ответить · копировать текст ·
 * копировать картинку · переслать · на доску · закрепить · редактировать · удалить.
 *
 * Появляется при наведении на строку сообщения: обёртке строки нужен класс
 * `tz-msg-row` (стили — в globals.additions.css). Подходит и для чата групп
 * (MessageArea), и для личных сообщений — передавайте только нужные колбэки,
 * лишние кнопки просто не отрисуются. Пример интеграции — в PATCHES.md.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { sendMessageToBoard } from "@/lib/boardBridge";
import { TriozEmojiGrid, type GroupEmojiOption } from "@/components/ui/TriozEmoji";

export type ToolbarAttachment = { url: string; name?: string; mime?: string };

export type ToolbarMessage = {
  id: string;
  /* FIX-DM-COPY: текста может не быть вовсе. Тип обещал строку, но в личные
     сообщения с одним вложениением с сервера приходит null — и обращение к
     .trim() при отрисовке валило всю переписку. Теперь это видно в типе. */
  content: string | null;
  attachments?: ToolbarAttachment[];
};

type Feedback = "Скопировано" | "Картинка скопирована" | "На доске" | "Ошибка" | null; // FIX-ICONS: без глифа ✓ в тексте

/* ── Буфер обмена ────────────────────────────────────────────────── */

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* переходим к фолбэку */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Копирование картинки-вложения в буфер. Браузеры стабильно принимают
 * только image/png — при необходимости перекодируем через canvas
 * (вложения в проекте хранятся в WebP).
 */
export async function copyImageToClipboard(url: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
    const res = await fetch(url);
    if (!res.ok) return false;
    let blob = await res.blob();
    if (blob.type !== "image/png") {
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      ctx.drawImage(bmp, 0, 0);
      blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"),
      );
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}

/* ── Иконки (16px, currentColor) ──────────────────────────────────────── */

const I = {
  reply: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></svg>
  ),
  copy: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
  ),
  smile: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M8.4 14.2a4.4 4.4 0 0 0 7.2 0" /><path d="M9.2 9.6h.01" /><path d="M14.8 9.6h.01" /></svg>
  ),
  image: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
  ),
  forward: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 17 20 12 15 7" /><path d="M4 18v-2a4 4 0 0 1 4-4h12" /></svg>
  ),
  board: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><path d="M14 6.5h7" /><path d="M17.5 3v7" /></svg>
  ),
  pin: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17v5" /><path d="M9 3h6l1 7 2 2H6l2-2 1-7z" /></svg>
  ),
  edit: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
  ),
  thread: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 9h8M8 13h5"/><path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.3-4A8 8 0 1 1 21 12Z"/></svg>
  ),
  trash: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
  ),
};

/* ── Компонент ─────────────────────────────────────────────────────── */

export default function MessageHoverToolbar({
  message,
  groupEmojis = [],
  canEdit,
  canDelete,
  pinned,
  onReply,
  onEdit,
  onDelete,
  onPin,
  onForward,
  onThread,
  threadCount = 0,
  onReact,
  boardContext,
  onHoverStart,
  onHoverEnd,
  children,
}: {
  message: ToolbarMessage;
  /** Свои эмодзи сообщества — их можно ставить реакцией так же, как обычные. */
  groupEmojis?: GroupEmojiOption[];
  canEdit?: boolean;
  canDelete?: boolean;
  pinned?: boolean;
  onReply?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPin?: () => void;
  onForward?: () => void;
  onThread?: () => void;
  threadCount?: number;
  onReact?: (emoji: string) => void;
  /** Контекст для «Отправить на доску»; если не задан — кнопка скрыта */
  boardContext?: { authorName?: string; channelName?: string; channelId?: string } | null;
  /** HOVER-GRACE: курсор зашёл на сам бар — список замораживает таймер скрытия. */
  onHoverStart?: () => void;
  /** Курсор ушёл с бара — таймер скрытия запускается заново. */
  onHoverEnd?: () => void;
  /** Доп. кнопки (например, быстрые реакции) */
  children?: ReactNode;
}) {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [reactionOpen, setReactionOpen] = useState(false);
  // Открывать сетку реакций вверх, когда снизу не хватает пикселей
  // (например, у последнего сообщения в чате — иначе эмодзи обрезаются).
  const [reactionUp, setReactionUp] = useState(false);
  const reactionWrapRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  /**
   * Пока открыт пикер реакций — снимаем content-visibility со строки сообщения.
   *
   * Строка чата обрезает всё, что выступает за её рамку (paint-containment, см.
   * `.tz-msg-row` в globals.css): без этого сетка эмодзи высотой в треть экрана
   * обрежется по краю сообщения. Раньше containment снимало наведение мышью, но
   * оно же дёргало раскладку — правило убрано, и пикер теперь просит снять
   * containment сам.
   *
   * Класс ставится на живой узел, а не через состояние родителя: тулбар живёт и
   * в канальном списке, и в личных сообщениях, а строки там мемоизированы — иначе
   * пришлось бы прокидывать проп через два разных списка ради одного пикера.
   */
  useEffect(() => {
    const row = rootRef.current?.closest(".tz-msg-row");
    if (!row) return;
    if (!reactionOpen) {
      row.classList.remove("tz-cv-show");
      return;
    }
    row.classList.add("tz-cv-show");
    return () => row.classList.remove("tz-cv-show");
  }, [reactionOpen]);

  // Примерная высота поповера с сеткой реакций (5 рядов по 44px + заголовок,
  // отступы и рамка). Используется для оценки нехватки места до открытия.
  const REACTION_POPOVER_HEIGHT = 330;

  const toggleReactions = () => {
    setReactionOpen((open) => {
      const next = !open;
      if (next) {
        /* Открытый пикер — тоже причина держать бар: курсор уходит в сетку
           эмодзи, а она выше строки сообщения. */
        onHoverStart?.();
        const rect = reactionWrapRef.current?.getBoundingClientRect();
        if (rect) {
          const spaceBelow = window.innerHeight - rect.bottom;
          const spaceAbove = rect.top;
          setReactionUp(spaceBelow < REACTION_POPOVER_HEIGHT && spaceAbove > spaceBelow);
        }
      }
      return next;
    });
  };

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const flash = (f: Feedback) => {
    setFeedback(f);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setFeedback(null), 1300);
  };

  const firstImage = message.attachments?.find((a) => (a.mime || "").startsWith("image/"));

  /* FIX-DM-COPY: единственное место, где текст приводится к строке. Ниже три
     места брали message.content напрямую, и одно из них (проверка «есть ли что
     копировать») выполнялось при каждой отрисовке — на сообщении без текста
     вылетала вся лента. */
  const contentText = typeof message.content === "string" ? message.content : "";

  const handleCopyText = async () => {
    flash((await copyTextToClipboard(contentText)) ? "Скопировано" : "Ошибка");
  };

  const handleCopyImage = async () => {
    if (!firstImage) return;
    flash((await copyImageToClipboard(firstImage.url)) ? "Картинка скопирована" : "Ошибка");
  };

  const handleSendToBoard = () => {
    sendMessageToBoard({
      content: contentText,
      messageId: message.id,
      authorName: boardContext?.authorName,
      channelName: boardContext?.channelName,
      channelId: boardContext?.channelId,
    });
    flash("На доске");
  };

  return (
    <div
      ref={rootRef}
      className="tz-msg-toolbar"
      role="toolbar"
      aria-label="Действия с сообщением"
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
    >
      {feedback && <span className="tz-toolbar-feedback">{feedback}</span>}
      {onReply && (
        <button type="button" onClick={onReply} title="Ответить" aria-label="Ответить">
          {I.reply}
        </button>
      )}
      {onThread && (
        <button type="button" onClick={onThread} title="Открыть ветку" aria-label="Открыть ветку" className="relative">
          {I.thread}{threadCount > 0 && <span className="ml-1 text-[10px] tabular-nums">{threadCount}</span>}
        </button>
      )}
      {onReact && (
        <div ref={reactionWrapRef} className="relative flex">
          {/* Значок, а не сам эмодзи. Цветной глиф здесь выпадал из ряда:
              соседи — контурные значки на currentColor, они темнеют при
              наведении и меняются вместе с темой, а жёлтое пятно оставалось
              жёлтым пятном. Смысл «поставить эмодзи» несёт окно, которое
              кнопка открывает, а не картинка на ней. */}
          <button type="button" onClick={toggleReactions} title="Добавить реакцию" aria-label="Добавить реакцию">
            {I.smile}
          </button>
          {reactionOpen && <div className={`tz-react-pop absolute z-50 rounded-xl border border-[var(--cn-border)] bg-[var(--cn-sidebar)] p-1.5 shadow-xl ${reactionUp ? "bottom-full mb-1" : "top-full mt-1"}`}><TriozEmojiGrid compact groupEmojis={groupEmojis} onSelect={(emoji) => { onReact(emoji); setReactionOpen(false); }}/></div>}
        </div>
      )}
      {contentText.trim().length > 0 && (
        <button type="button" onClick={handleCopyText} title="Копировать текст" aria-label="Копировать текст">
          {I.copy}
        </button>
      )}
      {firstImage && (
        <button type="button" onClick={handleCopyImage} title="Копировать картинку" aria-label="Копировать картинку">
          {I.image}
        </button>
      )}
      {onForward && (
        <button type="button" onClick={onForward} title="Переслать" aria-label="Переслать">
          {I.forward}
        </button>
      )}
      {boardContext !== undefined && boardContext !== null && (
        <button type="button" onClick={handleSendToBoard} title="Отправить на доску" aria-label="Отправить на доску">
          {I.board}
        </button>
      )}
      {onPin && (
        <button type="button" onClick={onPin} title={pinned ? "Открепить" : "Закрепить"} aria-label={pinned ? "Открепить" : "Закрепить"}>
          {I.pin}
        </button>
      )}
      {canEdit && onEdit && (
        <button type="button" onClick={onEdit} title="Редактировать" aria-label="Редактировать">
          {I.edit}
        </button>
      )}
      {children}
      {canDelete && onDelete && (
        <button type="button" className="danger" onClick={onDelete} title="Удалить" aria-label="Удалить">
          {I.trash}
        </button>
      )}
    </div>
  );
}
