"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import Spinner from "@/components/ui/Spinner";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import Link from "next/link";

interface Player {
  id: string;
  userId: string;
  faction: string | null;
  color: string | null;
  isReady: boolean;
  turnOrder: number;
  user: { id: string; name: string; username: string; avatar: string | null };
}

interface PendingInvite {
  id: string;
  invitee: { id: string; name: string; username: string; avatar: string | null };
}

interface Room {
  id: string;
  name: string;
  hostId: string;
  status: string;
  maxPlayers: number;
  inviteCode: string;
  host: { id: string; name: string; username: string; avatar: string | null };
  players: Player[];
  invites: PendingInvite[];
}

interface Friend {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
  friendshipId: string;
}

const FACTIONS = [
  { id: "empire", name: "Империя", color: "#ef4444", textColor: "text-red-400", bg: "from-red-900/30 to-red-950/30", border: "border-red-500/30" },
  { id: "republic", name: "Республика", color: "#3b82f6", textColor: "text-blue-400", bg: "from-blue-900/30 to-blue-950/30", border: "border-blue-500/30" },
  { id: "subbgars", name: "Суббгары", color: "#a855f7", textColor: "text-purple-400", bg: "from-purple-900/30 to-purple-950/30", border: "border-purple-500/30" },
  { id: "dwarves", name: "Дворфы", color: "#eab308", textColor: "text-yellow-400", bg: "from-yellow-900/30 to-yellow-950/30", border: "border-yellow-500/30" },
  { id: "delions", name: "Дэлионы", color: "#525252", textColor: "text-neutral-400", bg: "from-neutral-800/30 to-neutral-950/30", border: "border-neutral-500/30" },
  { id: "avains", name: "Авайны", color: "#f5f5f5", textColor: "text-white", bg: "from-gray-700/30 to-gray-900/30", border: "border-white/20" },
  { id: "ancients", name: "Союз Древних", color: "#92400e", textColor: "text-amber-700", bg: "from-amber-900/30 to-amber-950/30", border: "border-amber-700/30" },
  { id: "trolls", name: "Тролли", color: "#22c55e", textColor: "text-green-400", bg: "from-green-900/30 to-green-950/30", border: "border-green-500/30" },
  { id: "dark", name: "Тёмные", color: "#67e8f9", textColor: "text-cyan-400", bg: "from-cyan-900/30 to-cyan-950/30", border: "border-cyan-500/30" },
  { id: "rebellion", name: "Серебряный мятеж", color: "#9ca3af", textColor: "text-gray-400", bg: "from-gray-800/30 to-gray-950/30", border: "border-gray-500/30" },
];

function FloatingParticle({ delay, x, size }: { delay: number; x: number; size: number }) {
  return (
    <motion.div
      className="absolute rounded-full bg-red-500/20"
      style={{ left: `${x}%`, width: size, height: size }}
      initial={{ bottom: -10, opacity: 0 }}
      animate={{ bottom: "110%", opacity: [0, 0.6, 0] }}
      transition={{ duration: 8 + Math.random() * 4, delay, repeat: Infinity, ease: "linear" }}
    />
  );
}

function InviteFriendsModal({ roomId, existingPlayerIds, onClose }: { roomId: string; existingPlayerIds: string[]; onClose: () => void }) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/friends").then((r) => r.json()).then((data) => {
      if (data.friends) setFriends(data.friends);
    });
  }, []);

  const invite = async (friendId: string) => {
    setSending(friendId);
    const res = await fetch("/api/games/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, inviteeId: friendId }),
    });
    if (res.ok) {
      setSent((p) => new Set(p).add(friendId));
    }
    setSending(null);
  };

  const available = friends.filter((f) => !existingPlayerIds.includes(f.id));

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
        className="bg-neutral-900 border border-amber-500/20 rounded-2xl p-6 max-w-sm w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-white mb-4">Пригласить друзей</h3>
        {available.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">Нет доступных друзей для приглашения</p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {available.map((f) => (
              <div key={f.id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400/30 to-red-400/30 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                  {f.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{f.name}</div>
                  <div className="text-[10px] text-gray-500">@{f.username}</div>
                </div>
                <button
                  onClick={() => invite(f.id)}
                  disabled={sending === f.id || sent.has(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    sent.has(f.id)
                      ? "bg-green-500/20 text-green-400"
                      : "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                  } disabled:opacity-50`}
                >
                  {sent.has(f.id) ? "Отправлено" : sending === f.id ? "..." : "Пригласить"}
                </button>
              </div>
            ))}
          </div>
        )}
        <button onClick={onClose} className="w-full mt-4 px-4 py-2.5 bg-neutral-800 text-gray-400 rounded-xl hover:bg-neutral-700 transition-all text-sm">
          Закрыть
        </button>
      </motion.div>
    </motion.div>
  );
}

export default function RoomPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const params = useParams();
  const roomId = params.id as string;
  const [room, setRoom] = useState<Room | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRoom = useCallback(async () => {
    const res = await fetch(`/api/games/rooms/${roomId}`);
    if (res.ok) {
      const data = await res.json();
      setRoom(data);
      if (data.status === "PLAYING") {
        router.push(`/games/velderan/play/${roomId}`);
      }
    }
  }, [roomId, router]);

  useEffect(() => {
    fetchRoom();
    const interval = setInterval(fetchRoom, 3000);
    return () => clearInterval(interval);
  }, [fetchRoom]);

  const userId = (session?.user as { id?: string })?.id;
  const isHost = room?.hostId === userId;
  const myPlayer = room?.players.find((p) => p.userId === userId);

  const takenFactions = useMemo(() => {
    if (!room) return new Set<string>();
    return new Set(room.players.filter((p) => p.faction).map((p) => p.faction!));
  }, [room]);

  const selectFaction = async (factionId: string, color: string) => {
    setError(null);
    const res = await fetch(`/api/games/rooms/${roomId}/players`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faction: factionId, color }),
    });
    if (!res.ok) {
      const d = await res.json();
      setError(d.error);
    }
    fetchRoom();
  };

  const toggleReady = async () => {
    setError(null);
    const res = await fetch(`/api/games/rooms/${roomId}/players`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isReady: !myPlayer?.isReady }),
    });
    if (!res.ok) {
      const d = await res.json();
      setError(d.error);
    }
    fetchRoom();
  };

  const startGame = async () => {
    setError(null);
    const res = await fetch(`/api/games/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    });
    if (!res.ok) {
      const d = await res.json();
      setError(d.error);
    }
    fetchRoom();
  };

  const leaveRoom = async () => {
    await fetch(`/api/games/rooms/${roomId}/players`, { method: "DELETE" });
    router.push("/games/velderan");
  };

  const deleteRoom = async () => {
    if (!(await confirmDialog({ message: "Удалить комнату?", confirmText: "Удалить", danger: true }))) return;
    await fetch(`/api/games/rooms/${roomId}`, { method: "DELETE" });
    router.push("/games/velderan");
  };

  const addBot = async () => {
    setError(null);
    const res = await fetch(`/api/games/rooms/${roomId}/bot`, { method: "POST" });
    if (!res.ok) {
      const d = await res.json();
      setError(d.error);
    }
    fetchRoom();
  };

  const removeBot = async (botPlayerId: string) => {
    await fetch(`/api/games/rooms/${roomId}/bot`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ botPlayerId }),
    });
    fetchRoom();
  };

  const copyInviteLink = () => {
    if (!room) return;
    const url = `${window.location.origin}/games/velderan/join/${room.inviteCode}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const particles = useMemo(() =>
    Array.from({ length: 20 }, (_, i) => ({
      id: i,
      x: (i * 137.508) % 100,
      delay: i * 0.6,
      size: 2 + (i % 3) * 2,
    })),
  []);

  if (!room) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <Spinner tone="danger" />
      </div>
    );
  }

  const allReady = room.players.length >= 2 && room.players.every((p) => p.isReady || p.userId === room.hostId);

  return (
    <div className="min-h-screen bg-neutral-950 relative overflow-hidden">
      {/* Background map blur */}
      <div className="fixed inset-0 opacity-10">
        <Image src="/games/velderan/map.png" alt="" fill className="object-cover blur-sm" />
      </div>

      {/* Floating particles */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {particles.map((p) => (
          <FloatingParticle key={p.id} x={p.x} delay={p.delay} size={p.size} />
        ))}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-red-600/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-amber-600/5 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between mb-8">
          <div>
            <Link href="/games/velderan" className="text-gray-500 hover:text-gray-300 text-sm mb-2 block transition-colors">&larr; Назад к игре</Link>
            <h1 className="text-2xl md:text-3xl font-display font-bold text-white">{room.name}</h1>
            <p className="text-gray-500 text-sm mt-1">Хост: {room.host.name} · {room.players.length}/{room.maxPlayers} игроков</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={copyInviteLink}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                copied ? "bg-green-500/20 text-green-400" : "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
              } border border-amber-500/20`}>
              {copied ? "Скопировано!" : "Копировать ссылку"}
            </button>
            <button onClick={() => setShowInvite(true)}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-white/5 text-white hover:bg-white/10 transition-all border border-white/10">
              Пригласить
            </button>
          </div>
        </motion.div>

        {error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center">
            {error}
          </motion.div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Players List */}
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
            className="lg:col-span-1 bg-neutral-900/80 backdrop-blur-sm border border-white/5 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-white/5">
              <h2 className="text-lg font-bold text-white">Игроки</h2>
            </div>
            <div className="p-3 space-y-2">
              {room.players.map((p, i) => {
                const faction = FACTIONS.find((f) => f.id === p.faction);
                return (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${
                      faction ? `bg-gradient-to-r ${faction.bg} border ${faction.border}` : "bg-white/5 border border-white/5"
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: faction ? faction.color + "40" : "rgba(255,255,255,0.1)" }}>
                      {p.user.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm font-medium truncate">{p.user.name}</span>
                        {p.userId === room.hostId && <span className="text-amber-400 text-[10px]">👑</span>}
                        {p.userId.startsWith("bot-velderan-") && <span className="text-purple-400 text-[10px]">🤖</span>}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {faction ? (
                          <span style={{ color: faction.color }}>{faction.name}</span>
                        ) : (
                          "Выбирает фракцию..."
                        )}
                      </div>
                    </div>
                    {p.isReady && (
                      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
                        className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
                        <svg className="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </motion.div>
                    )}
                    {isHost && p.userId.startsWith("bot-velderan-") && (
                      <button onClick={() => removeBot(p.id)}
                        className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center hover:bg-red-500/30 transition-colors">
                        <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </motion.div>
                );
              })}

              {/* Pending invites */}
              {room.invites.map((inv) => (
                <div key={inv.id} className="flex items-center gap-3 px-3 py-3 rounded-xl bg-white/[0.02] border border-dashed border-white/10">
                  <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-sm text-gray-600 flex-shrink-0">
                    {inv.invitee.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-gray-500 text-sm truncate">{inv.invitee.name}</span>
                    <div className="text-[10px] text-gray-600">Ожидает...</div>
                  </div>
                  <div className="w-2 h-2 rounded-full bg-amber-500/50 animate-pulse" />
                </div>
              ))}

              {/* Empty slots */}
              {Array.from({ length: Math.max(0, room.maxPlayers - room.players.length - room.invites.length) }).map((_, i) => (
                <div key={`empty-${i}`} className="flex items-center gap-3 px-3 py-3 rounded-xl border border-dashed border-white/5">
                  <div className="w-10 h-10 rounded-full bg-white/[0.02] flex items-center justify-center">
                    <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <span className="text-gray-700 text-sm">Свободное место</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Faction Selection */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="lg:col-span-2 bg-neutral-900/80 backdrop-blur-sm border border-white/5 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-white/5">
              <h2 className="text-lg font-bold text-white">Выбор фракции</h2>
              <p className="text-gray-500 text-xs mt-1">Нажмите на фракцию, чтобы выбрать её</p>
            </div>
            <div className="p-4 grid grid-cols-2 md:grid-cols-5 gap-2">
              {FACTIONS.map((f) => {
                const taken = takenFactions.has(f.id);
                const isMine = myPlayer?.faction === f.id;
                const takenBy = room.players.find((p) => p.faction === f.id);

                return (
                  <motion.button
                    key={f.id}
                    whileHover={!taken || isMine ? { scale: 1.03 } : {}}
                    whileTap={!taken || isMine ? { scale: 0.97 } : {}}
                    onClick={() => {
                      if (isMine) {
                        selectFaction("", "");
                      } else if (!taken) {
                        selectFaction(f.id, f.color);
                      }
                    }}
                    disabled={taken && !isMine}
                    className={`relative p-3 rounded-xl border transition-all duration-300 text-left ${
                      isMine
                        ? `bg-gradient-to-br ${f.bg} ${f.border} shadow-lg ring-1`
                        : taken
                        ? "bg-neutral-800/50 border-white/5 opacity-40 cursor-not-allowed"
                        : `bg-neutral-800/50 border-white/5 hover:${f.border} hover:bg-gradient-to-br hover:${f.bg}`
                    }`}
                    style={isMine ? { boxShadow: `0 0 20px ${f.color}20, 0 0 0 1px ${f.color}40` } : {}}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-4 h-4 rounded-full flex-shrink-0 border"
                        style={{ backgroundColor: f.color, borderColor: f.id === "delions" ? "#666" : f.color }} />
                      <span className={`text-xs font-medium ${isMine ? f.textColor : taken ? "text-gray-600" : "text-gray-300"}`}>
                        {f.name}
                      </span>
                    </div>
                    {taken && takenBy && (
                      <div className="text-[9px] text-gray-600 truncate">{takenBy.user.name}</div>
                    )}
                    {isMine && (
                      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
                        className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </motion.div>
                    )}
                  </motion.button>
                );
              })}
            </div>

            {/* Map preview */}
            <div className="p-4 border-t border-white/5">
              <div className="relative rounded-xl overflow-hidden h-48 md:h-64">
                <Image src="/games/velderan/map.png" alt="Карта" fill className="object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-neutral-900/80 to-transparent" />
                <div className="absolute bottom-3 left-3 text-sm text-gray-400">Мир Вельд&apos;Эран</div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Bottom Action Bar */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="mt-6 bg-neutral-900/80 backdrop-blur-sm border border-white/5 rounded-2xl p-4 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="text-sm">
              <span className="text-gray-500">Статус: </span>
              <span className={`font-medium ${allReady ? "text-green-400" : "text-amber-400"}`}>
                {allReady ? "Все готовы!" : "Ожидание игроков..."}
              </span>
            </div>
            <div className="text-sm text-gray-600">
              Код: <code className="text-gray-400 font-mono">{room.inviteCode}</code>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isHost && (
              <button onClick={leaveRoom}
                className="px-4 py-2.5 bg-neutral-800 text-gray-400 rounded-xl hover:bg-neutral-700 hover:text-red-400 transition-all text-sm">
                Покинуть
              </button>
            )}
            {isHost && (
              <button onClick={addBot}
                className="px-4 py-2.5 bg-purple-500/20 text-purple-400 rounded-xl hover:bg-purple-500/30 transition-all text-sm border border-purple-500/20">
                + Бот
              </button>
            )}
            {isHost && (
              <button onClick={deleteRoom}
                className="px-4 py-2.5 bg-neutral-800 text-gray-400 rounded-xl hover:bg-neutral-700 hover:text-red-400 transition-all text-sm">
                Удалить
              </button>
            )}
            {myPlayer && !isHost && (
              <button onClick={toggleReady}
                className={`px-6 py-2.5 rounded-xl font-medium transition-all text-sm ${
                  myPlayer.isReady
                    ? "bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30"
                    : "bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30"
                }`}>
                {myPlayer.isReady ? "Готов ✓" : "Готов?"}
              </button>
            )}
            {isHost && (
              <button onClick={startGame} disabled={!allReady}
                className="px-8 py-2.5 bg-gradient-to-r from-red-600 to-amber-600 text-white rounded-xl font-medium hover:shadow-xl hover:shadow-red-500/20 transition-all text-sm disabled:opacity-40 disabled:cursor-not-allowed">
                Начать игру
              </button>
            )}
          </div>
        </motion.div>
      </div>

      {/* Invite Modal */}
      <AnimatePresence>
        {showInvite && (
          <InviteFriendsModal
            roomId={roomId}
            existingPlayerIds={room.players.map((p) => p.userId)}
            onClose={() => { setShowInvite(false); fetchRoom(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
