"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import GlowAvatar from "@/components/ui/GlowAvatar";
import { isOnline, timeAgo } from "@/lib/timeAgo";
import { VaultIcon } from "@/components/ui/ConnectIcons"; // FIX-ICONS: SVG вместо favorite.png
import type { Conversation } from "./dmTypes";

interface DMConversationListProps {
  conversations: Conversation[];
  selectedConv: string | null;
  currentUserId: string;
  onSelect: (convId: string) => void;
  /** FIX-VAULT: открыть/создать «Сейф» — переписку с самим собой */
  onOpenVault?: () => void;
  onClose?: () => void;
  /**
   * Название раздела. Панель одна на личные сообщения и на деловые обращения,
   * а называться «Личные сообщения» в разделе «Бизнес» она не должна: это не
   * переписка с приятелем, а разговор с администрацией по заявке.
   */
  title?: string;
  /** Что написать, когда разговоров нет: в разных разделах это разное. */
  emptyText?: string;
}

// FIX-DM-FAV: избранные диалоги (ПКМ → «В избранное»). Храним на клиенте —
// список id переписок, закреплённых вверху выдачи. Максимум пять.
const FAVORITES_KEY = "tz-dm-favorites";
const MAX_FAVORITES = 5;

// FIX-DM-SORT: направление ранжирования по времени сообщения. По запросу
// «чем раньше писал, тем выше» — восходящий порядок (самые ранние сверху).
// Вынесено отдельной константой, чтобы поведение можно было перевернуть на
// «самые свежие сверху» одной правкой (EARLIEST_FIRST = false).
const EARLIEST_FIRST = true;

function readFavorites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string").slice(0, MAX_FAVORITES)
      : [];
  } catch {
    return [];
  }
}

/** Timestamp (ms) used to rank a conversation; 0 when it has no messages. */
function convTime(conv: Conversation): number {
  const t = conv.lastMessageAt ? new Date(conv.lastMessageAt).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

export default function DMConversationList({
  conversations,
  selectedConv,
  currentUserId,
  onSelect,
  onOpenVault,
  onClose,
  title = "Личные сообщения",
  emptyText = "Нет диалогов",
}: DMConversationListProps) {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ convId: string; x: number; y: number } | null>(null);

  // Load persisted favorites once on mount (client only).
  useEffect(() => {
    setFavorites(readFavorites());
  }, []);

  const persistFavorites = useCallback((next: string[]) => {
    setFavorites(next);
    try {
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — избранное просто не сохранится между сессиями */
    }
  }, []);

  const isFavorite = useCallback((convId: string) => favorites.includes(convId), [favorites]);

  const toggleFavorite = useCallback((convId: string) => {
    setMenu(null);
    if (favorites.includes(convId)) {
      persistFavorites(favorites.filter((id) => id !== convId));
    } else if (favorites.length < MAX_FAVORITES) {
      persistFavorites([...favorites, convId]);
    }
    // При достижении лимита добавление молча игнорируется (см. подпись в меню).
  }, [favorites, persistFavorites]);

  // Close the context menu on any outside interaction.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // FIX-DM-SORT + FIX-DM-FAV: порядок выдачи.
  //   1) «Сейф» (переписка с собой) — всегда самый верх.
  //   2) Избранные диалоги — закреплены следующими.
  //   3) Остальные — по времени сообщения (по умолчанию: чем раньше писал, тем
  //      выше). Внутри избранных — тот же временной порядок.
  const ordered = useMemo(() => {
    const favSet = new Set(favorites);
    const rank = (conv: Conversation) => {
      if (conv.other.id === currentUserId) return 0; // Vault
      if (favSet.has(conv.id)) return 1;             // favorite
      return 2;                                       // regular
    };
    return [...conversations].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      // Внутри одного уровня — по времени. Диалоги без сообщений опускаются вниз
      // своего уровня независимо от направления сортировки.
      const ta = convTime(a);
      const tb = convTime(b);
      if (ta === 0 && tb === 0) return 0;
      if (ta === 0) return 1;
      if (tb === 0) return -1;
      return EARLIEST_FIRST ? ta - tb : tb - ta;
    });
  }, [conversations, favorites, currentUserId]);

  const menuConv = menu ? conversations.find((c) => c.id === menu.convId) ?? null : null;
  const menuIsFav = menu ? isFavorite(menu.convId) : false;
  const favLimitReached = favorites.length >= MAX_FAVORITES;

  return (
    <aside
      className={`w-60 max-md:w-full cn-sidebar flex-shrink-0 flex flex-col ${selectedConv ? "max-md:hidden" : ""}`}
    >
      <div className="p-3 border-b border-neutral-200 dark:border-white/5 flex items-center justify-between">
        <h2 className="font-bold text-neutral-900 dark:text-white text-sm">{title}</h2>
        <div className="flex items-center gap-1">
        {/* FIX-VAULT: кнопка создания/открытия Сейфа */}
        {onOpenVault && (
          <button
            onClick={onOpenVault}
            className="p-1 text-neutral-400 hover:text-amber-500 dark:hover:text-amber-400 transition-colors"
            title="Сейф — избранная переписка с самим собой"
            aria-label="Открыть Сейф"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-7a2 2 0 00-2-2H6a2 2 0 00-2 2v7a2 2 0 002 2zm10-11V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-white"
            aria-label="Закрыть"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {ordered.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-8 px-4 leading-relaxed">{emptyText}</p>
        ) : (
          ordered.map((conv) => {
            const hasUnread = (conv.unread ?? 0) > 0;
            const isVault = conv.other.id === currentUserId;
            const favorite = !isVault && isFavorite(conv.id);
            return (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                onContextMenu={(e) => {
                  if (isVault) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu({ convId: conv.id, x: e.clientX, y: e.clientY });
                }}
                className={`w-full text-left p-3 flex items-center gap-3 hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors ${
                  selectedConv === conv.id
                    ? "bg-[var(--cn-accent-dim)] border-l-2 border-[var(--cn-accent)]"
                    : ""
                }`}
              >
                <div className="relative flex-shrink-0">
                  {isVault ? (
                    <div className="w-9 h-9 rounded-full flex items-center justify-center bg-amber-100 dark:bg-amber-400/15 text-amber-500 dark:text-amber-400">
                      <VaultIcon size={22} style={{ color: "inherit" }} />
                    </div>
                  ) : (
                    <GlowAvatar
                      user={conv.other}
                      size={36}
                      onlineColor={isOnline(conv.other.lastSeen) ? "green" : undefined}
                    />
                  )}
                  {/* FIX-DM-FAV: звёздочка на закреплённом диалоге */}
                  {favorite && (
                    <span
                      className="absolute -bottom-1 -left-1 w-4 h-4 flex items-center justify-center rounded-full bg-amber-400 text-amber-950 ring-2 ring-[var(--cn-sidebar)]"
                      title="В избранном"
                    >
                      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2z" />
                      </svg>
                    </span>
                  )}
                  {hasUnread && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full ring-2 ring-[var(--cn-sidebar)]">
                      {conv.unread! > 99 ? "99+" : conv.unread}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate flex items-center gap-1.5 ${hasUnread ? "font-bold text-neutral-900 dark:text-white" : "font-medium text-neutral-900 dark:text-white"}`}>
                    <span className="truncate">{isVault ? "Сейф" : conv.other.name}</span>
                    {/* Связка для администрации: заявку ещё никто не взял. Это
                        единственное состояние очереди, требующее действия, —
                        только его и показываем прямо в списке. */}
                    {conv.business?.party === "handler" && !conv.business.handlerName && (
                      <span className="flex-shrink-0 rounded px-1.5 py-[1px] text-[10px] font-medium bg-amber-400/20 text-amber-600 dark:text-amber-300">
                        не взято
                      </span>
                    )}
                  </p>
                  {conv.lastMessage ? (
                    <p className={`text-xs truncate ${hasUnread ? "text-neutral-700 dark:text-gray-200 font-medium" : "text-neutral-400"}`}>
                      {conv.lastMessage.userId === currentUserId ? "Вы: " : ""}
                      {conv.lastMessage.content}
                    </p>
                  ) : (
                    <p className="text-xs text-neutral-400">Нет сообщений</p>
                  )}
                </div>
                {conv.lastMessageAt && (
                  <span className="text-[10px] text-neutral-400 flex-shrink-0">
                    {timeAgo(conv.lastMessageAt)}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* FIX-DM-FAV: контекстное меню по правой кнопке мыши (ПКМ) */}
      {menu && menuConv && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-[9999] min-w-[210px] py-1 rounded-lg border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-2xl text-sm"
          style={{
            left: Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 230),
            top: menu.y,
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
          role="menu"
        >
          <div className="px-3 py-1.5 text-[11px] text-neutral-400 truncate border-b border-neutral-100 dark:border-white/5">
            {menuConv.other.name}
          </div>
          {menuIsFav ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => toggleFavorite(menu.convId)}
              className="w-full text-left px-3 py-2 flex items-center gap-2 text-neutral-700 dark:text-gray-200 hover:bg-neutral-100 dark:hover:bg-white/5"
            >
              <svg className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2z" /></svg>
              Убрать из избранного
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              disabled={favLimitReached}
              onClick={() => toggleFavorite(menu.convId)}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 ${
                favLimitReached
                  ? "text-neutral-300 dark:text-neutral-600 cursor-not-allowed"
                  : "text-neutral-700 dark:text-gray-200 hover:bg-neutral-100 dark:hover:bg-white/5"
              }`}
              title={favLimitReached ? `Максимум ${MAX_FAVORITES} избранных диалогов` : undefined}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2z" /></svg>
              В избранное
            </button>
          )}
          {favLimitReached && !menuIsFav && (
            <div className="px-3 py-1.5 text-[11px] text-neutral-400">
              Достигнут лимит: {MAX_FAVORITES} диалога
            </div>
          )}
        </div>,
        document.body,
      )}
    </aside>
  );
}
