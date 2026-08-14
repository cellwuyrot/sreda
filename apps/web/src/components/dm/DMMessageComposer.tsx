"use client";

import type { ChangeEvent, ClipboardEvent, DragEvent } from "react";
import type { RefObject } from "react";
import Spinner from "@/components/ui/Spinner";
import VoiceRecorder from "@/components/ui/VoiceRecorder";
import MediaNoteRecorder from "@/components/ui/MediaNoteRecorder";
import { useMobile } from "@/hooks/useMobile";
import type { MediaNoteKind } from "@/lib/mediaNote";
import TypingIndicator from "@/components/ui/TypingIndicator";
import { useMentions, MentionPopupList, type MentionUser } from "@/components/ui/MentionPopup";
import { PlusMenu } from "@/components/connect/ChannelTools";
import type { Attachment } from "./dmTypes";
import { countWords, messageLimits } from "@/lib/messageLimits";
import { hasPremium } from "@/lib/premium";
import { useSession } from "next-auth/react";
import { TriozEmojiButton } from "@/components/ui/TriozEmoji";
import InfoTooltip from "@/components/ui/InfoTooltip";
/* FIX-FORMATS: тот же список, что проверяет сервер. Здесь раньше значились `.zip`
   и `.rar`, которые роут загрузки отклонял: выбрать файл можно, отправить — нет. */
import { CHAT_ATTACHMENT_ACCEPT } from "@/lib/attachmentTypes";
// FIX-ICONS: фирменные SVG-иконки вместо PNG и глифа «✕»
import { ShieldIcon, XIcon } from "@/components/ui/ConnectIcons";

interface DMMessageComposerProps {
  input: string;
  onInputChange: (v: string) => void;
  onSend: (e: React.FormEvent) => void;
  onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop: (e: DragEvent<HTMLFormElement>) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  isDragOver: boolean;
  onFileUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: RefObject<HTMLInputElement>;
  imageInputRef: RefObject<HTMLInputElement>;
  textareaRef: RefObject<HTMLTextAreaElement>;
  fileUploading: boolean;
  /** FIX-UPLOAD: прогресс текущей загрузки файла — полоска над формой. */
  uploadProgress?: { name: string; percent: number; index: number; total: number } | null;
  sending: boolean;
  voiceUploading: boolean;
  pendingAttachments: Attachment[];
  onRemoveAttachment: (index: number) => void;
  /**
   * Записанная заметка: голос или квадратное видеосообщение. Вид приходит
   * третьим доводом — от него зависит имя файла и пометка при загрузке.
   */
  onVoiceRecorded: (blob: Blob, duration: number, kind?: MediaNoteKind) => void;
  /**
   * Можно ли записывать видеосообщение. Выключено в деловом чате: там переписка
   * с администрацией по заявке, и квадрат с камеры там не к месту.
   */
  allowVideoNote?: boolean;
  replyTo: { id: string; name: string; content: string } | null;
  onCancelReply: () => void;
  // Format toolbar
  showFormatBar: boolean;
  onToggleFormatBar: () => void;
  onInsertFormat: (prefix: string, suffix: string) => void;
  // Geolocation picker
  onOpenGeo?: () => void;
  // Typing
  typingName: string | null;
  // Encryption indicator
  e2eeEnabled: boolean;
  // @mention candidates — only participants of this conversation
  mentionMembers?: MentionUser[];
}

/**
 * DM composer. Intentionally mirrors the group chat composer (see
 * `MessageArea.tsx`) so writing a direct message feels identical to writing in
 * a community channel: same rounded input shell, same paperclip / geolocation /
 * format-toolbar / voice controls, same @mention popup and auto-grow textarea.
 *
 * The only DM-specific bit kept from the old design is the end-to-end
 * encryption indicator (`e2eeEnabled`) shown in the format toolbar — that
 * uniqueness is deliberate; everything else matches groups.
 */
export default function DMMessageComposer(props: DMMessageComposerProps) {
  const {
    input,
    onInputChange,
    onSend,
    onPaste,
    onDrop,
    onDragOver,
    onDragLeave,
    isDragOver,
    onFileUpload,
    fileInputRef,
    imageInputRef,
    textareaRef,
    fileUploading,
    uploadProgress,
    sending,
    voiceUploading,
    pendingAttachments,
    onRemoveAttachment,
    onVoiceRecorded,
    allowVideoNote,
    replyTo,
    onCancelReply,
    showFormatBar,
    onToggleFormatBar,
    onInsertFormat,
    onOpenGeo,
    typingName,
    e2eeEnabled,
    mentionMembers = [],
  } = props;

  /* Узкий экран — значит телефон, в том числе оболочка Android. От этого зависит
     только вид кнопки записи в строке ввода. */
  const isMobileViewport = useMobile();

  const mentions = useMentions({
    members: mentionMembers,
    includeEveryone: false,
    onApply: (next, caretAfter) => {
      onInputChange(next);
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          ta.selectionStart = caretAfter;
          ta.selectionEnd = caretAfter;
        }
      });
    },
  });

  const hasContent = input.trim().length > 0 || pendingAttachments.length > 0;
  /* Предел длины зависит от подписки: без неё он вдвое меньше. */
  const { data: session } = useSession();
  const limits = messageLimits(hasPremium(session?.user));
  /** Длина в словах — для счётчика и блокировки отправки. */
  const words = countWords(input);
  const overLimit = words > limits.words || input.length > limits.chars;

  /* Обернуть выделенное в блок кода: тройные кавычки набирают руками редко и
     чаще не знают, что так можно. Открывающие кавычки встают на свою строку,
     иначе первая строка кода прилипнет к предыдущему абзацу. */
  const wrapSelectionAsCode = () => {
    const ta = textareaRef.current;
    const start = ta?.selectionStart ?? input.length;
    const end = ta?.selectionEnd ?? start;
    const selected = input.slice(start, end);
    const before = input.slice(0, start);
    const lead = before && !before.endsWith("\n") ? "\n" : "";
    onInputChange(`${before}${lead}\`\`\`\n${selected}\n\`\`\`\n${input.slice(end)}`);
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      const caret = before.length + lead.length + 4 + selected.length;
      ta.selectionStart = caret;
      ta.selectionEnd = caret;
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
    });
  };

  const insertEmoji = (emoji: string) => {
    const ta = textareaRef.current;
    const start = ta?.selectionStart ?? input.length;
    const end = ta?.selectionEnd ?? start;
    onInputChange(input.slice(0, start) + emoji + input.slice(end));
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      ta.selectionStart = start + emoji.length;
      ta.selectionEnd = start + emoji.length;
    });
  };

  return (
    <>
      {/* Typing indicator */}
      <TypingIndicator names={typingName ? [typingName] : []} />

      {/* Reply indicator */}
      {replyTo && (
        <div className="px-4 py-2 border-t border-[var(--cn-border)] flex items-center gap-2 text-xs text-neutral-500 dark:text-gray-400 bg-[var(--cn-accent-dim)]">
          <div className="w-0.5 h-4 bg-violet-400 dark:bg-cyan-400 rounded-full" />
          <span className="flex-1 truncate">
            Ответ для <strong className="text-neutral-700 dark:text-gray-300">{replyTo.name}</strong>: {replyTo.content}
          </span>
          <button onClick={onCancelReply} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white" aria-label="Отменить ответ">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Input */}
      <div className="relative z-20 border-t border-[var(--cn-border)] bg-[var(--cn-main)]/80 backdrop-blur-sm">
        {/* Extra tools panel */}
        {showFormatBar && (
          <div className="px-3 pt-2 pb-1">
            <div className="flex flex-wrap items-center gap-1 p-2 rounded-lg bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10">
              <span className="text-[10px] text-neutral-400 mr-1">
                Формат:{" "}
                <InfoTooltip text="Кнопки оборачивают выделенный кусок текста разметкой. Тройные кавычки — блок кода: переносы строк и отступы в нём сохраняются как есть." />
              </span>
              <button type="button" onClick={() => onInsertFormat("**", "**")} className="px-2 py-1 text-xs font-bold text-neutral-600 dark:text-neutral-300 hover:text-violet-600 dark:hover:text-cyan-400 hover:bg-violet-50 dark:hover:bg-white/10 rounded transition-colors" title="Жирный">B</button>
              <button type="button" onClick={() => onInsertFormat("*", "*")} className="px-2 py-1 text-xs italic text-neutral-600 dark:text-neutral-300 hover:text-violet-600 dark:hover:text-cyan-400 hover:bg-violet-50 dark:hover:bg-white/10 rounded transition-colors" title="Курсив">I</button>
              <button type="button" onClick={() => onInsertFormat("`", "`")} className="px-2 py-1 text-xs font-mono text-neutral-600 dark:text-neutral-300 hover:text-violet-600 dark:hover:text-cyan-400 hover:bg-violet-50 dark:hover:bg-white/10 rounded transition-colors" title="Код">&lt;/&gt;</button>
              {/* Блок кода — рядом с «кодом внутри строки»: одиночные кавычки
                  для имени переменной, тройные для куска программы. */}
              <button type="button" onClick={wrapSelectionAsCode} className="px-2 py-1 text-xs font-mono text-neutral-600 dark:text-neutral-300 hover:text-violet-600 dark:hover:text-cyan-400 hover:bg-violet-50 dark:hover:bg-white/10 rounded transition-colors" title="Блок кода — переносы и отступы сохраняются">```</button>
              <button type="button" onClick={() => onInsertFormat("\n- ", "")} className="px-2 py-1 text-xs text-neutral-600 dark:text-neutral-300 hover:text-violet-600 dark:hover:text-cyan-400 hover:bg-violet-50 dark:hover:bg-white/10 rounded transition-colors" title="Список">•</button>
              <div className="flex-1" />
              {e2eeEnabled && (
                <span className="text-[10px] text-green-600 dark:text-green-400 flex items-center gap-1" title="Сквозное шифрование включено">
                  <ShieldIcon size={14} style={{ color: "inherit" }} />
                  E2EE
                </span>
              )}
              <button type="button" onClick={onToggleFormatBar} className="px-1.5 py-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 rounded transition-colors" title="Закрыть" aria-label="Закрыть"><XIcon size={13} style={{ color: "inherit" }} /></button>
            </div>
          </div>
        )}

        <div className="p-3">
          {/* FIX-UPLOAD: полоска прогресса загрузки файла */}
          {fileUploading && uploadProgress && (
            <div className="mb-2 px-1">
              <div className="flex items-center justify-between gap-2 text-[11px] text-neutral-500 dark:text-gray-400 mb-1">
                <span className="truncate">
                  Загрузка{uploadProgress.total > 1 ? ` ${uploadProgress.index}/${uploadProgress.total}` : ""}: {uploadProgress.name}
                </span>
                <span className="flex-shrink-0 tabular-nums">{uploadProgress.percent}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-neutral-200 dark:bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-violet-500 dark:bg-cyan-400 transition-[width] duration-150"
                  style={{ width: `${uploadProgress.percent}%` }}
                />
              </div>
            </div>
          )}
          <form
            onSubmit={onSend}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`relative flex flex-wrap gap-2 items-end rounded-2xl border transition-colors px-2 py-1.5 focus-within:ring-2 focus-within:ring-violet-400/20 dark:focus-within:ring-cyan-400/20 focus-within:border-violet-400 dark:focus-within:border-cyan-400 ${isDragOver ? "bg-violet-50 dark:bg-cyan-900/10 border-violet-300 dark:border-cyan-700" : "border-[var(--cn-border)] bg-[var(--cn-card)]"}`}
          >
            {fileUploading ? (
              <span className="w-11 h-11 shrink-0 inline-flex items-center justify-center text-neutral-400"><Spinner size="sm" tone="current" /></span>
            ) : (
              <PlusMenu
                onAttach={() => fileInputRef.current?.click()}
                onImage={() => imageInputRef.current?.click()}
                onGeo={onOpenGeo}
                onToggleFormat={onToggleFormatBar}
                formatActive={showFormatBar}
              />
            )}
            <TriozEmojiButton onSelect={insertEmoji} />
            <input ref={fileInputRef} type="file" className="hidden" onChange={onFileUpload} accept={CHAT_ATTACHMENT_ACCEPT} multiple />
            <input ref={imageInputRef} type="file" className="hidden" onChange={onFileUpload} accept="image/*" multiple />

            {/* FIX-DM-ATTACH: плашки вложений занимают собственную строку над полем
                ввода. Раньше этот блок был обычным элементом того же горизонтального
                ряда и откусывал ширину у textarea. На телефоне, где в том же ряду ещё
                кнопка вложений, эмодзи и отправка, полю не оставалось ничего —
                текст набирался в полоску шириной в несколько пикселей и был не виден. */}
            {pendingAttachments.length > 0 && (
              <div className="order-first basis-full w-full flex flex-wrap gap-2 px-1 pb-1">
                {pendingAttachments.map((attachment, index) => (
                  <div key={`${attachment.url}-${index}`} className="flex items-center gap-2 max-w-[220px] rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3 py-2 text-xs text-neutral-600 dark:text-gray-300">
                    <span className="truncate">{attachment.name}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveAttachment(index)}
                      className="text-neutral-400 hover:text-red-500"
                      aria-label="Удалить вложение"
                    >
                      <XIcon size={13} style={{ color: "inherit" }} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="relative flex-1 min-w-0">
              {mentions.open && (
                <MentionPopupList
                  entries={mentions.entries}
                  activeIndex={mentions.activeIndex}
                  onPick={(entry) => mentions.pick(entry, input)}
                  onHover={mentions.setActiveIndex}
                />
              )}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  onInputChange(e.target.value);
                  mentions.update(e.target.value, e.target.selectionStart ?? e.target.value.length);
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                }}
                onPaste={onPaste}
                onKeyDown={(e) => {
                  if (mentions.handleKeyDown(e, input)) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSend(e as unknown as React.FormEvent);
                  }
                }}
                onClick={(e) => mentions.update(input, e.currentTarget.selectionStart ?? input.length)}
                onBlur={() => setTimeout(mentions.close, 150)}
                placeholder="Сообщение"
                className="input-field w-full !py-2.5 resize-none overflow-y-auto leading-tight placeholder:truncate"
                rows={1}
                style={{ minHeight: 44, maxHeight: 120 }}
                maxLength={limits.chars}
                aria-label="Написать сообщение"
              />
              {/* Счётчик появляется только у длинного текста: постоянные цифры
                  под полем ввода мешают, а узнать о пределе после того, как всё
                  набрано, — ещё хуже. */}
              {words > limits.words / 2 && (
                <div className={`mt-1 text-right text-[11px] tabular-nums ${overLimit ? "text-red-500" : "text-neutral-400 dark:text-neutral-500"}`}>
                  {words.toLocaleString("ru-RU")} / {limits.words.toLocaleString("ru-RU")} слов
                </div>
              )}
            </div>

            {/* Send / voice */}
            {hasContent ? (
              <button type="submit" disabled={sending || fileUploading || overLimit} className="btn-primary !px-4 !py-2.5 disabled:opacity-50" aria-label="Отправить сообщение" title={overLimit ? "Сообщение слишком длинное" : undefined}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            ) : (
              /* На телефоне — запись с мини-редактором: короткое нажатие
                 переключает микрофон и квадрат, удержание пишет, отпускание
                 ставит паузу. В защищённом режиме квадрат не предлагаем: файлы
                 там шифруются, и сервер такую загрузку помечает голосовой —
                 видеосообщение приехало бы получателю как голос. */
              isMobileViewport ? (
                <MediaNoteRecorder
                  onRecorded={onVoiceRecorded}
                  disabled={voiceUploading}
                  allowVideo={allowVideoNote !== false && !e2eeEnabled}
                />
              ) : (
                <VoiceRecorder onRecorded={onVoiceRecorded} disabled={voiceUploading} />
              )
            )}
          </form>
        </div>
      </div>
    </>
  );
}
