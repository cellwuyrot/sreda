"use client";

import { useEffect, useRef, useState } from "react";

export const TRIOZ_EMOJI_PACK = [
  { emoji: "❤️", id: "heart", label: "Любовь" },
  { emoji: "✅", id: "check", label: "Готово" },
  { emoji: "✨", id: "sparkles", label: "Восхищение" },
  { emoji: "🔥", id: "fire", label: "Огонь" },
  { emoji: "😭", id: "cry", label: "Сильная грусть" },
  { emoji: "😂", id: "joy", label: "Радость" },
  { emoji: "😊", id: "smile", label: "Улыбка" },
  { emoji: "💀", id: "skull", label: "Умер со смеху" },
  { emoji: "⭐", id: "star", label: "Звезда" },
  { emoji: "🫶", id: "heart-hands", label: "Поддержка" },
  { emoji: "👍", id: "like", label: "Нравится" },
  { emoji: "👀", id: "eyes", label: "Смотрю" },
  { emoji: "🙏", id: "pray", label: "Спасибо" },
  { emoji: "🎉", id: "party", label: "Праздник" },
  { emoji: "😍", id: "love", label: "Влюблённость" },
  { emoji: "🥹", id: "pleading", label: "Тронут" },
  { emoji: "🤣", id: "laugh", label: "Очень смешно" },
  { emoji: "😎", id: "cool", label: "Круто" },
  { emoji: "🤔", id: "think", label: "Думаю" },
  { emoji: "😢", id: "sad", label: "Грусть" },
  { emoji: "😡", id: "angry", label: "Злость" },
  { emoji: "👏", id: "clap", label: "Аплодисменты" },
  { emoji: "🚀", id: "rocket", label: "Запуск" },
  { emoji: "💯", id: "hundred", label: "Сто процентов" },
  { emoji: "😮", id: "wow", label: "Удивление" },
] as const;

const PACK_BY_EMOJI = new Map<string, (typeof TRIOZ_EMOJI_PACK)[number]>(TRIOZ_EMOJI_PACK.map((item) => [item.emoji, item] as const));
const EMOJI_REGEX = new RegExp(`(${TRIOZ_EMOJI_PACK.map((item) => item.emoji.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gu");

export function TriozEmoji({ emoji, size = 20, className = "" }: { emoji: string; size?: number; className?: string }) {
  const item = PACK_BY_EMOJI.get(emoji);
  if (!item) return <span className={className}>{emoji}</span>;
  return <img src={`/emojis/trioz/${item.id}.svg`} alt={item.label} title={item.label} width={size} height={size} className={`inline-block shrink-0 align-text-bottom ${className}`} draggable={false} />;
}

export function TriozText({ text }: { text: string }) {
  const parts = text.split(EMOJI_REGEX);
  return <>{parts.map((part, index) => PACK_BY_EMOJI.has(part) ? <TriozEmoji key={`${part}-${index}`} emoji={part} size={22} className="mx-0.5" /> : part)}</>;
}

/** Свои эмодзи сообщества: имя без двоеточий и адрес картинки 128×128. */
export interface GroupEmojiOption {
  id: string;
  name: string;
  url: string;
}

/**
 * Набор сообщества показывается ЗДЕСЬ, в той же кнопке, что и обычные эмодзи.
 * Отдельная кнопка рядом была ошибкой: человек ищет свои эмодзи там же, где
 * все остальные, и «в кнопке эмодзи их нет» — ровно то, на что жалуются.
 *
 * В реакции они тоже идут: реакция хранится строкой, и `:name:` в ней помещается
 * ничуть не хуже символа — раньше я счёл это невозможным, и был неправ.
 * В узкой раскладке (compact — это выбор реакции) набор показывается тем же
 * разделом, только ниже, чтобы окно не разрасталось.
 */
export function TriozEmojiGrid({ onSelect, compact = false, groupEmojis = [] }: { onSelect: (emoji: string) => void; compact?: boolean; groupEmojis?: GroupEmojiOption[] }) {
  const showGroup = groupEmojis.length > 0;
  return (
    <div className={`${compact ? "w-[280px]" : "w-[292px]"} max-w-[calc(100vw-24px)] rounded-2xl border border-[var(--cn-border)] bg-[var(--cn-sidebar)] shadow-2xl p-2.5`}>
      {showGroup && (
        <>
          <div className="px-1 pb-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-neutral-400">Эмодзи сообщества</div>
          <div className={`grid grid-cols-5 gap-1 mb-2 overflow-y-auto ${compact ? "max-h-[96px]" : "max-h-[168px]"}`}>
            {groupEmojis.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(`:${item.name}:`)}
                title={`:${item.name}:`}
                aria-label={`:${item.name}:`}
                className="w-full min-h-11 aspect-square rounded-xl flex items-center justify-center hover:bg-violet-500/10 dark:hover:bg-cyan-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:focus-visible:ring-cyan-400 transition-colors"
              >
                {/* Оптимизация картинок в проекте отключена намеренно. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.url} alt={`:${item.name}:`} width={34} height={34} loading="lazy" decoding="async" className="w-[34px] h-[34px] object-contain" draggable={false} />
              </button>
            ))}
          </div>
        </>
      )}
      <div className="px-1 pb-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-neutral-400">TrioZ reactions</div>
      <div className="grid grid-cols-5 gap-1">
        {TRIOZ_EMOJI_PACK.map((item) => (
          <button key={item.id} type="button" onClick={() => onSelect(item.emoji)} title={item.label} aria-label={item.label} className="w-full min-h-11 aspect-square rounded-xl flex items-center justify-center hover:bg-violet-500/10 dark:hover:bg-cyan-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:focus-visible:ring-cyan-400 transition-colors">
            <TriozEmoji emoji={item.emoji} size={34} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function TriozEmojiButton({ onSelect, align = "left", groupEmojis = [] }: { onSelect: (emoji: string) => void; align?: "left" | "right"; groupEmojis?: GroupEmojiOption[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      {/* Кнопка выглядит и ведёт себя как соседняя кнопка инструментов
          (ChannelTools): та же коробка 44×44, тот же контурный значок 20×20 на
          currentColor, то же открытое состояние. Раньше здесь стоял цветной
          эмодзи 28×28 — он не подчинялся ни наведению, ни теме и выпадал из
          ряда. Эмодзи теперь там, где им место: внутри открывающегося окна. */}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:focus-visible:ring-cyan-400 ${open ? "text-violet-500 dark:text-cyan-400 bg-[var(--cn-accent-dim)]" : "text-neutral-400 hover:text-violet-500 dark:hover:text-cyan-400 hover:bg-[var(--cn-hover)]"}`}
        aria-label="Открыть эмодзи TrioZ"
        aria-expanded={open}
        title="Эмодзи"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M8.4 14.2a4.4 4.4 0 007.2 0" />
          <path d="M9.2 9.6h.01" />
          <path d="M14.8 9.6h.01" />
        </svg>
      </button>
      {open && <div className={`absolute bottom-full mb-2 z-50 ${align === "right" ? "right-0" : "left-[-48px]"}`}><TriozEmojiGrid groupEmojis={groupEmojis} onSelect={(emoji) => { onSelect(emoji); setOpen(false); }} /></div>}
    </div>
  );
}
