"use client";

import { useState, useEffect, useCallback } from "react";
import Button from "@/components/ui/Button";
import { motion, AnimatePresence } from "framer-motion";
import { isOnline, timeAgo } from "@/lib/timeAgo";
import GlowAvatar from "@/components/ui/GlowAvatar";
import { UserPlusIcon } from "@/components/ui/ConnectIcons"; // FIX-ICONS: SVG вместо add-friend.png
import { io } from "socket.io-client";

interface Friend {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
  friendshipId: string;
  role?: string;
  avatarGlowEnabled?: boolean;
  avatarGlowColors?: string | null;
  lastSeen?: string | null;
}

interface PendingRequest {
  id: string;
  sender: { id: string; name: string; username: string; avatar: string | null };
  createdAt: string;
}

interface SentRequest {
  id: string;
  receiver: { id: string; name: string; username: string; avatar: string | null };
  createdAt: string;
}

interface FriendsData {
  friends: Friend[];
  pending: PendingRequest[];
  sent: SentRequest[];
}

type Tab = "friends" | "pending" | "add";

interface FriendsPanelProps {
  onMessageFriend?: (friendId: string) => void;
}

export default function FriendsPanel({ onMessageFriend }: FriendsPanelProps) {
  const [data, setData] = useState<FriendsData>({ friends: [], pending: [], sent: [] });
  const [tab, setTab] = useState<Tab>("friends");
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState<{ text: string; type: "ok" | "err" } | null>(null);
  const [loading, setLoading] = useState(false);
  const [friendConfirm, setFriendConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);

  const fetchFriends = useCallback(async () => {
    const res = await fetch("/api/friends");
    if (res.ok) {
      const d = await res.json();
      setData(d);
    }
  }, []);

  useEffect(() => {
    fetchFriends();

    // Подписываемся на мгновенный сигнал об изменении через личную комнату
    // dm-<userId>, которая уже используется для уведомлений. Отдельное
    // соединение не нужно — сокет закроется вместе с панелью.
    const sock = io({ path: "/api/socketio", withCredentials: true });
    sock.on("friends-updated", fetchFriends);

    // Запасной опрос раз в 60 с: защита от потери события (разрыв соединения,
    // устаревший клиент у собеседника). Не работает на скрытой вкладке.
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const startInterval = () => {
      clearInterval(intervalId);
      if (document.visibilityState === "hidden") return;
      intervalId = setInterval(() => {
        if (document.visibilityState !== "hidden") fetchFriends();
      }, 60_000);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Вкладка снова активна — немедленно синхронизируем и запускаем таймер
        fetchFriends();
        startInterval();
      } else {
        clearInterval(intervalId);
      }
    };

    startInterval();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      sock.disconnect();
    };
  }, [fetchFriends]);

  const sendRequest = async () => {
    if (!username.trim()) return;
    setLoading(true);
    setMessage(null);
    const res = await fetch("/api/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim().replace(/^@+/, "") }),
    });
    const d = await res.json();
    if (res.ok) {
      setMessage({ text: "Запрос отправлен!", type: "ok" });
      setUsername("");
      fetchFriends();
    } else {
      setMessage({ text: d.error || "Ошибка", type: "err" });
    }
    setLoading(false);
  };

  const acceptRequest = async (id: string) => {
    await fetch(`/api/friends/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept" }),
    });
    fetchFriends();
  };

  const declineRequest = async (id: string) => {
    await fetch(`/api/friends/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "decline" }),
    });
    fetchFriends();
  };

  const removeFriend = (friendshipId: string) => {
    setFriendConfirm({
      message: "Удалить из друзей?",
      onConfirm: async () => {
        await fetch(`/api/friends/${friendshipId}`, { method: "DELETE" });
        setFriendConfirm(null);
        fetchFriends();
      },
    });
  };

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "friends", label: "Друзья", count: data.friends.length },
    { key: "pending", label: "Входящие", count: data.pending.length },
    { key: "add", label: "Добавить" },
  ];

  return (
    <div className="w-60 max-md:w-full cn-sidebar flex flex-col h-full flex-shrink-0">
      {/* Header */}
      <div className="p-3 border-b border-neutral-200 dark:border-white/5 flex items-center justify-between flex-shrink-0">
        <span className="text-sm font-semibold text-neutral-900 dark:text-white">Друзья</span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-200 dark:border-white/5 flex-shrink-0">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 px-2 py-2 text-xs font-medium transition-colors relative ${
              tab === t.key
                ? "text-accent"
                : "text-neutral-400 hover:text-neutral-600 dark:hover:text-gray-300"
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-[var(--cn-accent-dim)] text-[var(--cn-accent-text)] text-[10px]">
                {t.count}
              </span>
            )}
            {tab === t.key && (
              <motion.div layoutId="friends-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--cn-accent)]" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2">
        <AnimatePresence mode="wait">
          {tab === "friends" && (
            <motion.div key="friends" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-0.5">
              {data.friends.length === 0 ? (
                <div className="text-center py-8 text-neutral-400 text-sm">
                  <UserPlusIcon size={44} tone="muted" className="mx-auto mb-2 opacity-60" />
                  <p>Пока нет друзей</p>
                  <button onClick={() => setTab("add")} className="text-violet-500 dark:text-cyan-400 mt-2 text-xs hover:underline inline-flex items-center gap-1">
                    <UserPlusIcon size={14} style={{ color: "inherit" }} />
                    Добавить друга
                  </button>
                </div>
              ) : (
                data.friends.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setSelectedFriend(f)}
                    className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-[var(--cn-hover)] transition-colors text-left"
                  >
                    <div className="relative flex-shrink-0">
                      <GlowAvatar
                        user={{ id: f.id, name: f.name, avatar: f.avatar, role: f.role ?? "USER", avatarGlowEnabled: f.avatarGlowEnabled, avatarGlowColors: f.avatarGlowColors }}
                        size={32}
                        onlineColor={isOnline(f.lastSeen) ? "green" : "gray"}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-neutral-900 dark:text-white truncate">{f.name}</div>
                      <div className="text-[10px] text-neutral-400">
                        @{f.username} {!isOnline(f.lastSeen) && f.lastSeen && <span className="text-neutral-400/70">· {timeAgo(f.lastSeen)}</span>}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </motion.div>
          )}

          {tab === "pending" && (
            <motion.div key="pending" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
              {data.pending.length === 0 && data.sent.length === 0 ? (
                <div className="text-center py-8 text-neutral-400 text-sm">Нет запросов</div>
              ) : (
                <>
                  {data.pending.map((r) => (
                    <div key={r.id} className="px-2 py-2 rounded-lg bg-[var(--cn-accent-dim)] space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-green-400/30 to-emerald-400/30 flex items-center justify-center text-xs font-bold text-neutral-700 dark:text-white flex-shrink-0">
                          {r.sender.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-neutral-900 dark:text-white truncate">{r.sender.name}</div>
                          <div className="text-[10px] text-neutral-400">@{r.sender.username}</div>
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={() => acceptRequest(r.id)}
                          className="flex-1 px-2 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded-lg text-xs font-medium hover:bg-green-500/20 transition-colors">
                          Принять
                        </button>
                        <button onClick={() => declineRequest(r.id)}
                          className="flex-1 px-2 py-1 bg-red-500/10 text-red-500 dark:text-red-400 rounded-lg text-xs font-medium hover:bg-red-500/20 transition-colors">
                          Отклонить
                        </button>
                      </div>
                    </div>
                  ))}
                  {data.sent.length > 0 && (
                    <>
                      <div className="text-[11px] text-neutral-400 uppercase tracking-wider px-2 pt-2">Отправленные</div>
                      {data.sent.map((r) => (
                        <div key={r.id} className="flex items-center gap-2 px-2 py-2 rounded-lg bg-[var(--cn-accent-dim)]">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400/30 to-orange-400/30 flex items-center justify-center text-xs font-bold text-neutral-700 dark:text-white flex-shrink-0">
                            {r.receiver.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-neutral-900 dark:text-white truncate">{r.receiver.name}</div>
                            <div className="text-[10px] text-neutral-400">@{r.receiver.username} · Ожидание</div>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </motion.div>
          )}

          {tab === "add" && (
            <motion.div key="add" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-2 space-y-3">
              <div className="flex items-center gap-2">
                <UserPlusIcon size={20} />
                <p className="text-sm text-neutral-500">Введите username друга:</p>
              </div>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendRequest()}
                placeholder="@username"
                className="w-full bg-[var(--cn-accent-dim)] border border-[var(--cn-border)] rounded-xl px-3 py-2.5 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400"
                autoFocus
              />
              <Button onClick={sendRequest} disabled={loading || !username.trim()} size="md" fullWidth>
                {loading ? "..." : "Отправить запрос"}
              </Button>
              {message && (
                <p className={`text-xs ${message.type === "ok" ? "text-green-500" : "text-red-500"}`}>
                  {message.text}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Friend Profile Modal */}
      <AnimatePresence>
        {selectedFriend && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setSelectedFriend(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-72 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Banner */}
              <div className="h-20 bg-gradient-to-br from-violet-500/30 to-cyan-500/30 dark:from-violet-600/40 dark:to-cyan-600/40 relative">
                <button
                  onClick={() => setSelectedFriend(null)}
                  className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/20 hover:bg-black/40 text-white flex items-center justify-center transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {/* Avatar */}
              <div className="flex justify-center -mt-10">
                <div className="ring-4 ring-white dark:ring-neutral-900 rounded-full">
                  <GlowAvatar
                    user={{ id: selectedFriend.id, name: selectedFriend.name, avatar: selectedFriend.avatar, role: selectedFriend.role ?? "USER", avatarGlowEnabled: selectedFriend.avatarGlowEnabled, avatarGlowColors: selectedFriend.avatarGlowColors }}
                    size={72}
                    onlineColor={isOnline(selectedFriend.lastSeen) ? "green" : "gray"}
                  />
                </div>
              </div>

              {/* Info */}
              <div className="text-center px-4 pt-2 pb-1">
                <div className="text-base font-semibold text-neutral-900 dark:text-white">{selectedFriend.name}</div>
                <div className="text-xs text-neutral-400">@{selectedFriend.username}</div>
                <div className="text-[10px] text-neutral-400 mt-1">
                  {isOnline(selectedFriend.lastSeen) ? (
                    <span className="text-green-500">В сети</span>
                  ) : selectedFriend.lastSeen ? (
                    <span>Был(а) {timeAgo(selectedFriend.lastSeen)}</span>
                  ) : null}
                </div>
              </div>

              {/* Actions */}
              <div className="px-4 pb-4 pt-2 space-y-1.5">
                <a
                  href={`/user/${selectedFriend.username}`}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-violet-500/10 dark:bg-cyan-500/10 text-accent hover:bg-violet-500/20 dark:hover:bg-cyan-500/20 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  Открыть профиль
                </a>
                {onMessageFriend && (
                  <button
                    onClick={() => { onMessageFriend(selectedFriend.id); setSelectedFriend(null); }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-violet-500/10 dark:bg-cyan-500/10 text-accent hover:bg-violet-500/20 dark:hover:bg-cyan-500/20 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                    Написать
                  </button>
                )}
                <button
                  onClick={() => { removeFriend(selectedFriend.friendshipId); setSelectedFriend(null); }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-red-500 hover:bg-red-500/10 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  Удалить из друзей
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {friendConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => setFriendConfirm(null)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative z-10 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl shadow-2xl p-5 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <p className="text-sm text-neutral-900 dark:text-white mb-4">{friendConfirm.message}</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setFriendConfirm(null)} className="px-4 py-2 text-sm text-neutral-500 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/5">Отмена</button>
              <button onClick={friendConfirm.onConfirm} className="px-4 py-2 text-sm bg-red-500 text-white rounded-xl hover:bg-red-600">Подтвердить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
