"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import {
  TRIOZ_EMOJI_PACK, findReactionEmoji, matchesEmojiQuery, normalizeEmojiQuery,
  parseRecentEmoji, prependRecentEmoji, splitEmojiText, REACTION_EMOJI_ASSET_VERSION,
  RECENT_EMOJI_KEY, RECENT_EMOJI_EVENT, type RecentEmoji,
} from "@/lib/reactionEmoji";
export { TRIOZ_EMOJI_PACK } from "@/lib/reactionEmoji";

/** Local, versioned SVG assets. Unknown sequences retain native Unicode rendering. */
export function TriozEmoji({ emoji, size = 24, className = "" }: { emoji: string; size?: number; className?: string }) {
  const item = findReactionEmoji(emoji);
  const [broken, setBroken] = useState<string | null>(null);
  if (!item || broken === item.id) return (
    <span role="img" aria-label={item?.label || emoji} title={item?.label || emoji}
      className={`tz-emoji tz-emoji-glyph ${className}`} style={{ fontSize: size, width: size, height: size }}>{emoji}</span>
  );
  return (
    // These local SVGs must not use an external image proxy or CDN.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/emojis/trioz/${item.id}.svg?v=${REACTION_EMOJI_ASSET_VERSION}`} alt={item.label} title={item.label}
      width={size} height={size} style={{ width: size, height: size }} className={`tz-emoji ${className}`}
      draggable={false} decoding="async" onError={() => setBroken(item.id)} />
  );
}

export function TriozText({ text }: { text: string }) {
  return <>{splitEmojiText(text).map((part, index) => findReactionEmoji(part)
    ? <TriozEmoji key={`${index}-${part}`} emoji={part} size={22} className="mx-0.5" /> : part)}</>;
}

export interface GroupEmojiOption { id: string; name: string; url: string }
interface Choice { emoji: string; label: string; id: string; customId?: string; url?: string }
function readRecents(): RecentEmoji[] {
  try { return parseRecentEmoji(window.localStorage.getItem(RECENT_EMOJI_KEY)); } catch { return []; }
}

/** Shared picker for message insertion and reactions. Never fetches or uploads history. */
export function TriozEmojiGrid({ onSelect, compact = false, groupEmojis = [], onClose }: {
  onSelect: (emoji: string) => void; compact?: boolean; groupEmojis?: GroupEmojiOption[]; onClose?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"all" | "recent" | "group">("all");
  const [recent, setRecent] = useState<RecentEmoji[]>([]);
  const searchId = useId();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setRecent(readRecents());
    const refresh = () => setRecent(readRecents());
    const storage = (e: StorageEvent) => { if (e.key === RECENT_EMOJI_KEY || e.key === null) refresh(); };
    window.addEventListener(RECENT_EMOJI_EVENT, refresh);
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener(RECENT_EMOJI_EVENT, refresh); window.removeEventListener("storage", storage); };
  }, []);
  const builtin: Choice[] = TRIOZ_EMOJI_PACK.map(item => ({ ...item }));
  const custom: Choice[] = groupEmojis.map(item => ({ emoji: `:${item.name}:`, label: item.name, id: item.name, customId: item.id, url: item.url }));
  const availableRecent = recent.map(item => item.customId
    ? custom.find(option => option.customId === item.customId && option.emoji === item.emoji)
    : builtin.find(option => option.emoji === item.emoji)).filter((item): item is Choice => !!item);
  const activeTab = tab === "group" && !custom.length ? "all" : tab;
  const filter = (items: Choice[]) => items.filter(item => item.customId
    ? normalizeEmojiQuery(`${item.emoji} ${item.label}`).includes(normalizeEmojiQuery(query))
    : matchesEmojiQuery(item, query));
  const sections = activeTab === "recent" ? [{ label: "Недавние", items: filter(availableRecent) }]
    : activeTab === "group" ? [{ label: "Эмодзи сообщества", items: filter(custom) }]
    : [...(custom.length ? [{ label: "Эмодзи сообщества", items: filter(custom) }] : []), { label: "TrioZ reactions", items: filter(builtin) }];
  const hasResults = sections.some(section => section.items.length > 0);
  const choose = (item: Choice) => {
    const value: RecentEmoji = item.customId ? { emoji: item.emoji, customId: item.customId } : { emoji: item.emoji };
    let next = prependRecentEmoji(recent, value);
    try { next = prependRecentEmoji([...parseRecentEmoji(window.localStorage.getItem(RECENT_EMOJI_KEY)), ...recent], value); window.localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(next)); window.dispatchEvent(new Event(RECENT_EMOJI_EVENT)); } catch { /* Storage denial must never prevent a reaction. */ }
    setRecent(next);
    onSelect(item.emoji);
  };
  const clearRecent = () => {
    try { window.localStorage.removeItem(RECENT_EMOJI_KEY); window.dispatchEvent(new Event(RECENT_EMOJI_EVENT)); } catch { /* Memory-only mode. */ }
    setRecent([]);
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && onClose) { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLButtonElement>("button[data-emoji-choice]");
    if (!target || !root.current) return;
    const buttons = Array.from(root.current.querySelectorAll<HTMLButtonElement>("button[data-emoji-choice]"));
    const index = buttons.indexOf(target);
    const offsets: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 5, ArrowUp: -5 };
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : event.key in offsets ? Math.min(buttons.length - 1, Math.max(0, index + offsets[event.key])) : -1;
    if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
  };
  return (
    <div ref={root} role="dialog" aria-label="Выбор эмодзи" className={`tz-emoji-picker ${compact ? "tz-emoji-picker-compact" : ""}`} onKeyDown={keyboard}>
      <div className="tz-emoji-picker-heading"><strong>{compact ? "Добавить реакцию" : "Эмодзи"}</strong><span>TrioZ</span></div>
      <div className="tz-emoji-search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
        <label className="sr-only" htmlFor={searchId}>Найти эмодзи</label>
        <input id={searchId} type="search" placeholder="Найти эмоцию" value={query} onChange={event => setQuery(event.target.value)} maxLength={100} autoComplete="off" spellCheck={false} />
      </div>
      <div className="tz-emoji-tabs" role="group" aria-label="Наборы эмодзи">
        <button type="button" aria-pressed={activeTab === "all"} onClick={() => setTab("all")}>Все</button>
        <button type="button" aria-pressed={activeTab === "recent"} onClick={() => setTab("recent")}>Недавние</button>
        {custom.length > 0 && <button type="button" aria-pressed={activeTab === "group"} onClick={() => setTab("group")}>Сообщество</button>}
      </div>
      <div className="tz-emoji-picker-results">
        {sections.map(section => section.items.length > 0 && <section key={section.label} aria-label={section.label}>
          <h3>{section.label}</h3><div className="tz-emoji-choice-grid">{section.items.map(item => (
            <button data-emoji-choice key={item.customId || item.id} type="button" onClick={() => choose(item)} title={item.customId ? item.emoji : item.label} aria-label={item.label}>
              {item.url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={item.url} alt="" width={40} height={40} loading="lazy" decoding="async" className="tz-emoji" style={{ width: 40, height: 40 }} draggable={false} />
                : <TriozEmoji emoji={item.emoji} size={40} />}
            </button>
          ))}</div>
        </section>)}
        {!hasResults && <p role="status" className="tz-emoji-empty">{query.trim() ? "Эмодзи не найдены. Попробуйте другое слово." : "Здесь появятся недавно выбранные эмодзи."}</p>}
      </div>
      {activeTab === "recent" && availableRecent.length > 0 && <button type="button" className="tz-emoji-clear" onClick={clearRecent}>Очистить недавние</button>}
    </div>
  );
}

/** Keep the existing DOM/hover ownership, but clamp the panel to the viewport. */
export function EmojiPopover({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const offset = useRef({ x: 0, y: 0 });
  const [shift, setShift] = useState({ x: 0, y: 0 });
  useEffect(() => {
    let frame = 0;
    const adjust = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!ref.current) return;
        const box = ref.current.getBoundingClientRect();
        const viewport = window.visualViewport;
        const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
        const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
        const baseX = box.left - offset.current.x, baseY = box.top - offset.current.y;
        const x = Math.max(left + 12, Math.min(baseX, left + width - box.width - 12)) - baseX;
        const y = Math.max(top + 12, Math.min(baseY, top + height - box.height - 12)) - baseY;
        if (Math.abs(x - offset.current.x) > .5 || Math.abs(y - offset.current.y) > .5) {
          offset.current = { x, y }; setShift(offset.current);
        }
      });
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(adjust) : null;
    if (ref.current) observer?.observe(ref.current);
    window.addEventListener("resize", adjust); window.addEventListener("scroll", adjust, true);
    window.visualViewport?.addEventListener("resize", adjust); window.visualViewport?.addEventListener("scroll", adjust);
    adjust();
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener("resize", adjust); window.removeEventListener("scroll", adjust, true); window.visualViewport?.removeEventListener("resize", adjust); window.visualViewport?.removeEventListener("scroll", adjust); };
  }, []);
  return <div id={id} ref={ref} className={className} style={{ transform: `translate(${shift.x}px, ${shift.y}px)` }}>{children}</div>;
}

export function TriozEmojiButton({ onSelect, align = "left", groupEmojis = [] }: { onSelect: (emoji: string) => void; align?: "left" | "right"; groupEmojis?: GroupEmojiOption[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null), buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = () => { setOpen(false); buttonRef.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);
  return <div ref={ref} className="relative shrink-0" onKeyDown={event => { if (event.key === "Escape" && open) { event.stopPropagation(); close(); } }}>
    <button ref={buttonRef} type="button" onClick={() => setOpen(value => !value)} className={`w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:focus-visible:ring-cyan-400 ${open ? "text-violet-500 dark:text-cyan-400 bg-[var(--cn-accent-dim)]" : "text-neutral-400 hover:text-violet-500 dark:hover:text-cyan-400 hover:bg-[var(--cn-hover)]"}`} aria-label="Открыть эмодзи TrioZ" aria-expanded={open} aria-controls={open ? panelId : undefined} aria-haspopup="dialog" title="Эмодзи">
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8.4 14.2a4.4 4.4 0 007.2 0M9.2 9.6h.01M14.8 9.6h.01" /></svg>
    </button>
    {open && <EmojiPopover id={panelId} className={`absolute bottom-full mb-2 z-50 ${align === "right" ? "right-0" : "left-[-48px]"}`}><TriozEmojiGrid groupEmojis={groupEmojis} onClose={close} onSelect={emoji => { onSelect(emoji); close(); }} /></EmojiPopover>}
  </div>;
}
