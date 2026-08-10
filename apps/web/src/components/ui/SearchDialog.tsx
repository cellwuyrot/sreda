"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Spinner from "@/components/ui/Spinner";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import GlowAvatar from "@/components/ui/GlowAvatar";

interface SearchResult {
  articles?: ArticleResult[];
  messages?: MessageResult[];
  users?: UserResult[];
}

interface ArticleResult {
  id: string;
  title: string;
  slug: string;
  category: string;
  snippet: string;
  createdAt: string;
}

interface MessageResult {
  id: string;
  content: string;
  snippet: string;
  createdAt: string;
  channelId: string;
  user: { id: string; name: string; username: string; avatar: string | null };
  channel: { id: string; name: string; group: { id: string; name: string } };
}

interface UserResult {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
  role: string;
  avatarGlowEnabled?: boolean;
  avatarGlowColors?: string | null;
}

type SearchTab = "all" | "articles" | "messages" | "users";

interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function SearchDialog({ open, onClose }: SearchDialogProps) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<SearchTab>("all");
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery("");
      setResults(null);
      setTab("all");
    }
  }, [open]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (open) onClose();
        // Opening is handled by parent
      }
      if (e.key === "Escape" && open) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const search = useCallback(async (q: string, t: SearchTab) => {
    if (!q.trim() || q.length < 2) {
      setResults(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&type=${t}`);
      if (res.ok) setResults(await res.json());
    } catch {
      setResults(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => search(query, tab), 300);
    return () => clearTimeout(timer);
  }, [query, tab, search]);

  if (!open) return null;

  const tabs: { key: SearchTab; label: string }[] = [
    { key: "all", label: "Все" },
    { key: "articles", label: "Статьи" },
    { key: "messages", label: "Сообщения" },
    { key: "users", label: "Пользователи" },
  ];

  const hasResults = results && (
    (results.articles?.length || 0) > 0 ||
    (results.messages?.length || 0) > 0 ||
    (results.users?.length || 0) > 0
  );

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[15vh]"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          className="w-full max-w-2xl bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-white/10 shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-200 dark:border-white/5">
            <svg className="w-5 h-5 text-neutral-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по статьям, сообщениям, пользователям..."
              className="flex-1 bg-transparent text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none"
              autoComplete="off"
            />
            {loading && (
              <Spinner size="sm" className="flex-shrink-0" />
            )}
            <kbd className="hidden sm:block text-[10px] text-neutral-400 bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded border border-neutral-200 dark:border-white/10">
              ESC
            </kbd>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 px-4 py-2 border-b border-neutral-200 dark:border-white/5">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                  tab === t.key
                    ? "bg-violet-100 dark:bg-cyan-400/15 text-accent"
                    : "text-neutral-500 dark:text-gray-400 hover:bg-neutral-100 dark:hover:bg-white/5"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Results */}
          <div className="max-h-[400px] overflow-y-auto">
            {!query.trim() && (
              <div className="py-12 text-center text-neutral-400 text-sm">
                Начните вводить для поиска
              </div>
            )}

            {query.length >= 2 && !loading && !hasResults && (
              <div className="py-12 text-center text-neutral-400 text-sm">
                Ничего не найдено
              </div>
            )}

            {/* Articles */}
            {results?.articles && results.articles.length > 0 && (
              <div className="p-2">
                <div className="px-2 py-1 text-[11px] text-neutral-400 uppercase tracking-wider font-semibold">Статьи</div>
                {results.articles.map((a) => (
                  <Link
                    key={a.id}
                    href={`/library/${a.slug}`}
                    onClick={onClose}
                    className="block px-3 py-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs px-1.5 py-0.5 bg-emerald-500/10 text-emerald-500 rounded">{a.category}</span>
                      <span className="text-sm font-medium text-neutral-900 dark:text-white">{a.title}</span>
                    </div>
                    <p className="text-xs text-neutral-500 dark:text-gray-400 line-clamp-1">{a.snippet}</p>
                  </Link>
                ))}
              </div>
            )}

            {/* Messages */}
            {results?.messages && results.messages.length > 0 && (
              <div className="p-2">
                <div className="px-2 py-1 text-[11px] text-neutral-400 uppercase tracking-wider font-semibold">Сообщения</div>
                {results.messages.map((m) => (
                  <div
                    key={m.id}
                    className="px-3 py-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs text-neutral-400">{m.channel.group.name}</span>
                      <span className="text-xs text-neutral-400">{">"}</span>
                      <span className="text-xs text-neutral-400">#{m.channel.name}</span>
                      <span className="text-xs text-neutral-500 ml-auto">{m.user.name}</span>
                    </div>
                    <p className="text-sm text-neutral-700 dark:text-gray-300 line-clamp-2">{m.snippet}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Users */}
            {results?.users && results.users.length > 0 && (
              <div className="p-2">
                <div className="px-2 py-1 text-[11px] text-neutral-400 uppercase tracking-wider font-semibold">Пользователи</div>
                {results.users.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors"
                  >
                    <GlowAvatar user={u} size={32} />
                    <div>
                      <div className="text-sm font-medium text-neutral-900 dark:text-white">{u.name}</div>
                      <div className="text-xs text-neutral-400">@{u.username}</div>
                    </div>
                    {u.role === "ADMIN" && <span className="text-[10px] text-amber-500 ml-auto">Admin</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
