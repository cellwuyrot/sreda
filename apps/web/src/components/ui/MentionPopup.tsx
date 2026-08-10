"use client";

import { useCallback, useMemo, useState } from "react";

export interface MentionUser {
  id: string;
  username?: string | null;
  name?: string | null;
  avatar?: string | null;
  lastSeen?: string | null;
}

export interface MentionQuery {
  /** Lower-cased text typed after "@" */
  query: string;
  /** Index of the "@" character in the source text */
  start: number;
}

export const MENTION_LIMIT = 10;

/**
 * Detects an in-progress @mention right before the caret.
 * Returns null when the caret is not inside a mention.
 */
export function getMentionQuery(text: string, caret: number): MentionQuery | null {
  const upto = text.slice(0, caret);
  const match = upto.match(/(?:^|[\s([{>])@([A-Za-z0-9_а-яА-ЯёЁ]*)$/);
  if (!match) return null;
  const typed = match[1] ?? "";
  return { query: typed.toLowerCase(), start: caret - typed.length - 1 };
}

/**
 * Filters + sorts candidates: last active first, max `limit` entries.
 * Only users passed in `members` are ever suggested (no global user base).
 */
export function filterMentionUsers(members: MentionUser[], query: string, limit = MENTION_LIMIT): MentionUser[] {
  const seen = new Set<string>();
  return members
    .filter((member) => {
      if (!member.username || seen.has(member.username)) return false;
      seen.add(member.username);
      if (!query) return true;
      return (
        member.username.toLowerCase().startsWith(query) ||
        (member.name || "").toLowerCase().startsWith(query)
      );
    })
    .sort((a, b) => new Date(b.lastSeen || 0).getTime() - new Date(a.lastSeen || 0).getTime())
    .slice(0, limit);
}

/** Replaces the in-progress mention with "@username " and returns the new text + caret position. */
export function insertMention(text: string, mention: MentionQuery, caret: number, username: string): { next: string; caretAfter: number } {
  const before = text.slice(0, mention.start);
  const after = text.slice(caret);
  const inserted = `@${username} `;
  return { next: `${before}${inserted}${after}`, caretAfter: before.length + inserted.length };
}

interface UseMentionsOptions {
  members: MentionUser[];
  /** Show the @everyone entry (group chats only) */
  includeEveryone?: boolean;
  /** Apply the new text + caret to the bound input */
  onApply: (nextValue: string, caretAfter: number) => void;
}

export interface MentionEntry {
  id: string;
  username: string;
  name: string | null;
  isEveryone?: boolean;
  lastSeen?: string | null;
  avatar?: string | null;
}

/**
 * Headless mention-autocomplete state machine for a textarea/input.
 * Call `update` on every change/caret move, `handleKeyDown` before your own
 * key handling, and render `<MentionPopupList>` with the returned entries.
 */
export function useMentions({ members, includeEveryone = false, onApply }: UseMentionsOptions) {
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);

  const entries = useMemo<MentionEntry[]>(() => {
    if (!mention) return [];
    const users = filterMentionUsers(members, mention.query).map((user) => ({
      id: user.id,
      username: user.username as string,
      name: user.name ?? null,
      lastSeen: user.lastSeen ?? null,
      avatar: user.avatar ?? null,
    }));
    const list: MentionEntry[] = [];
    if (includeEveryone && "everyone".startsWith(mention.query)) {
      list.push({ id: "everyone", username: "everyone", name: "Уведомить всех участников", isEveryone: true });
    }
    return [...list, ...users].slice(0, MENTION_LIMIT);
  }, [mention, members, includeEveryone]);

  const update = useCallback((value: string, caretPos: number) => {
    const found = getMentionQuery(value, caretPos);
    setMention(found);
    setCaret(caretPos);
    setActiveIndex(0);
  }, []);

  const close = useCallback(() => setMention(null), []);

  const pick = useCallback((entry: MentionEntry, currentValue: string) => {
    if (!mention) return;
    const { next, caretAfter } = insertMention(currentValue, mention, caret, entry.username);
    setMention(null);
    onApply(next, caretAfter);
  }, [mention, caret, onApply]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, currentValue: string): boolean => {
    if (!mention || entries.length === 0) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % entries.length);
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + entries.length) % entries.length);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(entries[activeIndex], currentValue);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setMention(null);
      return true;
    }
    return false;
  }, [mention, entries, activeIndex, pick]);

  return { open: !!mention && entries.length > 0, entries, activeIndex, update, close, pick, handleKeyDown, setActiveIndex };
}

/* ═══════════ FIX-TAGMENTION: автодополнение тегов группы по «#» ═══════════
   Отдельная машинка состояний рядом с @-упоминаниями: триггер — решётка,
   кандидаты — теги (GroupRole) сообщества. Подставляется «#имя », дальше текст
   разбирает renderContent и сервер (POST /api/messages). */

export interface RoleTagOption { id: string; name: string; color: string }

/** Ищет незавершённый «#тег» прямо перед кареткой. */
export function getTagQuery(text: string, caret: number): MentionQuery | null {
  const upto = text.slice(0, caret);
  const match = upto.match(/(?:^|[\s([{>])#([A-Za-z0-9_а-яА-ЯёЁ-]*)$/);
  if (!match) return null;
  const typed = match[1] ?? "";
  return { query: typed.toLowerCase(), start: caret - typed.length - 1 };
}

export function useRoleTagMentions({ roles, onApply }: {
  roles: RoleTagOption[];
  onApply: (nextValue: string, caretAfter: number) => void;
}) {
  const [tag, setTag] = useState<MentionQuery | null>(null);
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);

  const entries = useMemo<RoleTagOption[]>(() => {
    if (!tag) return [];
    const q = tag.query;
    // Теги с пробелами упомянуть одним словом нельзя — не предлагаем их.
    return roles
      .filter((r) => r.name && !/\s/.test(r.name))
      .filter((r) => (q ? r.name.toLowerCase().startsWith(q) : true))
      .slice(0, MENTION_LIMIT);
  }, [tag, roles]);

  const update = useCallback((value: string, caretPos: number) => {
    setTag(getTagQuery(value, caretPos));
    setCaret(caretPos);
    setActiveIndex(0);
  }, []);

  const close = useCallback(() => setTag(null), []);

  const pick = useCallback((entry: RoleTagOption, currentValue: string) => {
    if (!tag) return;
    const before = currentValue.slice(0, tag.start);
    const after = currentValue.slice(caret);
    const inserted = `#${entry.name} `;
    setTag(null);
    onApply(`${before}${inserted}${after}`, before.length + inserted.length);
  }, [tag, caret, onApply]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, currentValue: string): boolean => {
    if (!tag || entries.length === 0) return false;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => (i + 1) % entries.length); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => (i - 1 + entries.length) % entries.length); return true; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(entries[activeIndex], currentValue); return true; }
    if (e.key === "Escape") { e.preventDefault(); setTag(null); return true; }
    return false;
  }, [tag, entries, activeIndex, pick]);

  return { open: !!tag && entries.length > 0, entries, activeIndex, update, close, pick, handleKeyDown, setActiveIndex };
}

export function TagPopupList({ entries, activeIndex, onPick, onHover, className = "" }: {
  entries: RoleTagOption[];
  activeIndex: number;
  onPick: (entry: RoleTagOption) => void;
  onHover?: (index: number) => void;
  className?: string;
}) {
  if (entries.length === 0) return null;
  return (
    <div className={`absolute bottom-full left-0 right-0 mb-1 z-40 max-h-64 overflow-y-auto rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-800 shadow-xl py-1 ${className}`} role="listbox" aria-label="Теги сообщества">
      {entries.map((entry, index) => (
        <button
          key={entry.id}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          onMouseDown={(e) => { e.preventDefault(); onPick(entry); }}
          onMouseEnter={() => onHover?.(index)}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${index === activeIndex ? "bg-violet-500/10 dark:bg-cyan-400/10" : "hover:bg-neutral-100 dark:hover:bg-white/5"}`}
        >
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium text-neutral-900 dark:text-white">#{entry.name}</span>
          <span className="flex-none text-[11px] text-neutral-400">тег сообщества</span>
        </button>
      ))}
    </div>
  );
}

export function MentionPopupList({ entries, activeIndex, onPick, onHover, className = "" }: {
  entries: MentionEntry[];
  activeIndex: number;
  onPick: (entry: MentionEntry) => void;
  onHover?: (index: number) => void;
  className?: string;
}) {
  if (entries.length === 0) return null;
  return (
    <div className={`absolute bottom-full left-0 right-0 mb-1 z-40 max-h-64 overflow-y-auto rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-800 shadow-xl py-1 ${className}`} role="listbox" aria-label="Упоминания">
      {entries.map((entry, index) => (
        <button
          key={entry.id}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          onMouseDown={(e) => { e.preventDefault(); onPick(entry); }}
          onMouseEnter={() => onHover?.(index)}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${index === activeIndex ? "bg-violet-500/10 dark:bg-cyan-400/10" : "hover:bg-neutral-100 dark:hover:bg-white/5"}`}
        >
          {entry.isEveryone ? (
            <span className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-300 flex items-center justify-center text-[11px] font-bold flex-shrink-0" aria-hidden>@</span>
          ) : entry.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={entry.avatar} alt="" className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
          ) : (
            <span className="w-6 h-6 rounded-full bg-violet-500/20 dark:bg-cyan-500/20 text-violet-600 dark:text-cyan-400 flex items-center justify-center text-[11px] font-semibold flex-shrink-0" aria-hidden>
              {(entry.name || entry.username).charAt(0).toUpperCase()}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-neutral-900 dark:text-white">@{entry.username}</span>
            {entry.name && <span className="block truncate text-[11px] text-neutral-400">{entry.name}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
