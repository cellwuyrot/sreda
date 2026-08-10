"use client";

/*
 * FIX-THREAD: ветка обсуждения — компактное всплывающее окно возле сообщения
 * вместо панели на всю высоту приложения.
 *
 * - Окно привязывается к сообщению (anchor) и не выходит за края экрана:
 *   если снизу не хватает места, открывается над точкой привязки.
 * - Высота динамическая: короткая ветка — маленькое окно; длинная переписка
 *   прокручивается внутри, а окно не растёт выше лимита (540px / высота окна).
 * - Клик мимо окна или Esc закрывает ветку.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import GlowAvatar from "@/components/ui/GlowAvatar";
import Spinner from "@/components/ui/Spinner";
import type { Message } from "./messageTypes";
import { renderContent } from "./messageFormat";
import { XIcon, ChatIcon } from "@/components/ui/ConnectIcons"; // FIX-ICONS

interface ThreadPanelProps {
  /* Свои эмодзи сообщества. Без этой карты `:name:` в ветке остался бы просто
     текстом — в самой ленте картинка, а в обсуждении того же сообщения нет. */
  emoji?: Map<string, string>;
  rootMessage: Message;
  replies: Message[];
  /** Экранная точка привязки окна (обычно под сообщением). */
  anchor?: { x: number; y: number } | null;
  input: string;
  loading: boolean;
  sending: boolean;
  error: string | null;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onClose: () => void;
}

const EDGE = 12; // минимальный отступ окна от краёв экрана

export default function ThreadPanel({ rootMessage, replies, anchor, input, loading, sending, error, emoji, onInputChange, onSend, onClose }: ThreadPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Держим список прокрученным к последнему ответу.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [replies.length, loading]);

  // Esc закрывает окно.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Авто-высота поля ответа (сбрасывается после отправки, когда input пустеет).
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 96) + "px";
  }, [input]);

  // Позиционирование: окно уже отрендерено, меряем фактический размер и
  // ставим его возле точки привязки, не выходя за края экрана. Пересчёт —
  // при изменении содержимого (размер окна динамический) и ресайзе.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = anchor ? anchor.x : (vw - width) / 2;
      let top = anchor ? anchor.y : (vh - height) / 2;
      if (left + width > vw - EDGE) left = vw - width - EDGE;
      if (left < EDGE) left = EDGE;
      if (top + height > vh - EDGE) {
        // Снизу не влезает — пробуем открыть над точкой привязки.
        top = anchor ? anchor.y - height - 18 : vh - height - EDGE;
      }
      if (top + height > vh - EDGE) top = vh - height - EDGE;
      if (top < EDGE) top = EDGE;
      setPos({ left, top });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [anchor, replies.length, loading, error]);

  return (
    <>
      {/* Прозрачная подложка: клик мимо окна закрывает ветку, чат не затемняется */}
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <motion.div
        ref={panelRef}
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.16, ease: "easeOut" }}
        style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? "visible" : "hidden" }}
        className="z-50 flex w-[min(420px,calc(100vw-24px))] max-h-[min(540px,calc(100vh-24px))] flex-col overflow-hidden rounded-2xl border border-[var(--cn-border)] bg-[var(--cn-sidebar)] shadow-2xl"
        role="dialog" aria-label="Ветка обсуждения"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-[var(--cn-border)] px-3 py-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--cn-accent-dim)] text-[var(--cn-accent-text)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 9h8M8 13h5"/><path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.3-4A8 8 0 1 1 21 12Z"/></svg>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xs font-semibold text-neutral-900 dark:text-white">Ветка обсуждения</h2>
            <p className="truncate text-[10px] text-neutral-500">{replies.length} ответов</p>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-[var(--cn-hover)] hover:text-neutral-700 dark:hover:text-white" aria-label="Закрыть ветку"><XIcon size={14} style={{ color: "inherit" }} /></button>
        </header>

        {/* Исходное сообщение (длинный текст прокручивается, не раздувая окно) */}
        <div className="max-h-32 shrink-0 overflow-y-auto border-b border-[var(--cn-border)] bg-[var(--cn-accent-dim)]/40 px-3 py-2.5">
          <div className="flex gap-2.5">
            <GlowAvatar user={rootMessage.user} size={28}/>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold text-neutral-900 dark:text-white">{rootMessage.user.name}</span>
                <time className="text-[10px] text-neutral-400">{new Date(rootMessage.createdAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
              </div>
              <div className="mt-0.5 break-words text-sm text-neutral-700 dark:text-neutral-200">{renderContent(rootMessage.content, { emoji })}</div>
            </div>
          </div>
        </div>

        {/* Ответы: высота по содержимому, при переполнении — прокрутка */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
          {loading ? (
            <div className="flex items-center justify-center py-6"><Spinner/></div>
          ) : error ? (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-500">{error}</div>
          ) : replies.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-5 text-center">
              <ChatIcon size={28} tone="muted" className="mb-2" />
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">Ответов пока нет</p>
              <p className="mt-1 text-xs text-neutral-400">Начните отдельное обсуждение, не перегружая основной канал.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {replies.map((reply) => (
                <article key={reply.id} className="flex gap-2.5">
                  <GlowAvatar user={reply.user} size={26}/>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold text-neutral-900 dark:text-white">{reply.user.name}</span>
                      <time className="text-[10px] text-neutral-400">{new Date(reply.createdAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
                    </div>
                    <div className="mt-0.5 break-words text-sm text-neutral-700 dark:text-neutral-200">{renderContent(reply.content, { emoji })}</div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-[var(--cn-border)] p-2.5">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
              placeholder="Ответить в ветке…"
              rows={1}
              className="input-field min-h-10 flex-1 resize-none !py-2 text-sm"
              autoFocus
            />
            <button onClick={onSend} disabled={!input.trim() || sending} className="btn-primary flex h-10 w-10 items-center justify-center !p-0 disabled:opacity-50" aria-label="Отправить ответ">
              {sending ? "…" : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-neutral-400">Enter — отправить · Shift+Enter — новая строка</p>
        </footer>
      </motion.div>
    </>
  );
}
