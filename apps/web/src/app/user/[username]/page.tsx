"use client";

import { useState, useEffect } from "react";
import Spinner from "@/components/ui/Spinner";
import Button from "@/components/ui/Button";
import { useSession } from "next-auth/react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import GlowAvatar from "@/components/ui/GlowAvatar";
import { isOnline, timeAgo } from "@/lib/timeAgo";

interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  imageUrl: string | null;
  rarity: string;
  awardedAt: string;
}

interface UserProfile {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
  role: string;
  bio: string | null;
  socialLinks: { telegram?: string; vk?: string; github?: string; website?: string } | null;
  customStatus: string | null;
  statusEmoji: string | null;
  avatarGlowEnabled: boolean;
  avatarGlowColors: string | null;
  profileBanner: string | null;
  lastSeen: string | null;
  showOnline: boolean;
  createdAt: string;
  stats: { messages: number; friends: number; games: number };
  badges: Badge[];
  commonGroups: { id: string; name: string; icon: string | null }[];
  isFriend: boolean;
  isSelf: boolean;
  pendingRequest: { id: string; isSender: boolean } | null;
}

const ROLE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  ADMIN: { label: "Администратор", color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
  EDITOR: { label: "Редактор", color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20" },
  CONSULTANT: { label: "Консультант", color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
  USER: { label: "Пользователь", color: "text-gray-400", bg: "bg-gray-500/10 border-gray-500/20" },
};

const RARITY_COLORS: Record<string, string> = {
  common: "border-gray-500/30 bg-gray-500/5",
  uncommon: "border-green-500/30 bg-green-500/5",
  rare: "border-blue-500/30 bg-blue-500/5",
  epic: "border-purple-500/30 bg-purple-500/5",
  legendary: "border-amber-500/30 bg-amber-500/5",
};

export default function UserProfilePage() {
  const { username } = useParams<{ username: string }>();
  const { data: session } = useSession();
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [friendLoading, setFriendLoading] = useState(false);

  useEffect(() => {
    if (!username) return;
    setLoading(true);
    fetch(`/api/profile/public?username=${username}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setProfile(data);
      })
      .catch(() => setError("Ошибка загрузки"))
      .finally(() => setLoading(false));
  }, [username]);

  const handleAddFriend = async () => {
    if (!profile) return;
    setFriendLoading(true);
    const res = await fetch("/api/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: profile.username }),
    });
    if (res.ok) {
      setProfile((p) => p ? { ...p, pendingRequest: { id: "", isSender: true } } : p);
    }
    setFriendLoading(false);
  };

  const handleStartDM = async () => {
    if (!profile) return;
    const res = await fetch("/api/dm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: profile.username }),
    });
    if (res.ok) {
      router.push("/connect?dm=true");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <Spinner />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <div className="text-center">
          <span className="text-5xl block mb-4">😕</span>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">Пользователь не найден</h1>
          <p className="text-neutral-400 mb-4">{error || "Такого пользователя не существует"}</p>
          {/* FIX-NAV: возврат ведёт в TZ Connect, а не на главную сайта */}
          <Link href="/connect" className="text-violet-500 dark:text-cyan-400 hover:underline text-sm">Назад в TZ Connect</Link>
        </div>
      </div>
    );
  }

  const role = ROLE_LABELS[profile.role] ?? ROLE_LABELS.USER;
  const onlineNow = profile.showOnline && isOnline(profile.lastSeen);
  const memberSince = new Date(profile.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 pt-16 pb-12 px-4">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Back — FIX-NAV: «Назад» из полного профиля ведёт в /connect, а не на главную */}
        <Link href="/connect" className="inline-flex items-center gap-1 text-sm text-accent hover:opacity-70 transition-opacity">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Назад
        </Link>

        {/* Main profile card with banner */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl overflow-hidden shadow-lg"
        >
          {/* Banner + Avatar wrapper */}
          <div className="relative">
            <div className="h-40 sm:h-48 bg-gradient-to-br from-violet-600 via-indigo-600 to-cyan-500 overflow-hidden">
              {profile.profileBanner ? (
                <img src={profile.profileBanner} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="absolute inset-0">
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-violet-600/50 via-transparent to-cyan-500/30" />
                  <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black/30 to-transparent" />
                </div>
              )}
            </div>
            {/* Avatar overlay — outside overflow-hidden banner */}
            <div className="absolute -bottom-10 left-6 sm:left-8 z-10">
              <div className="ring-4 ring-white dark:ring-neutral-900 rounded-full">
                <GlowAvatar user={profile} size={88} onlineColor={onlineNow ? "green" : undefined} />
              </div>
            </div>
          </div>

          {/* Info section */}
          <div className="pt-14 px-6 sm:px-8 pb-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">{profile.name}</h1>
                  {profile.role !== "ADMIN" && <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${role.bg} ${role.color}`}>{role.label}</span>}
                </div>
                <p className="text-sm text-neutral-500 dark:text-gray-400 mt-0.5">@{profile.username}</p>

                {profile.customStatus && (
                  <div className="mt-2 flex items-center gap-1.5 text-sm text-neutral-600 dark:text-gray-400">
                    {profile.statusEmoji && <span>{profile.statusEmoji}</span>}
                    <span>{profile.customStatus}</span>
                  </div>
                )}

                {profile.showOnline && profile.lastSeen && (
                  <p className="text-xs text-neutral-400 mt-1.5">
                    {onlineNow ? (
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Онлайн</span>
                    ) : `Был(а) ${timeAgo(profile.lastSeen)}`}
                  </p>
                )}
              </div>

              {/* Actions */}
              {!profile.isSelf && session && (
                <div className="flex gap-2 flex-shrink-0 flex-wrap">
                  <Button onClick={handleStartDM} size="md">
                    Написать
                  </Button>
                  {!profile.isFriend && (
                    profile.pendingRequest ? (
                      <span className="px-5 py-2.5 bg-neutral-100 dark:bg-white/5 text-neutral-500 rounded-xl text-sm">
                        {profile.pendingRequest.isSender ? "Запрос отправлен" : "Ожидает принятия"}
                      </span>
                    ) : (
                      <button onClick={handleAddFriend} disabled={friendLoading} className="px-5 py-2.5 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-xl text-sm font-medium hover:shadow-lg hover:shadow-green-500/20 transition-all disabled:opacity-50">
                        {friendLoading ? "..." : "Добавить в друзья"}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>

            {/* Bio */}
            {profile.bio && (
              <p className="text-sm text-neutral-600 dark:text-gray-400 leading-relaxed border-l-2 border-violet-500/30 dark:border-cyan-500/30 pl-3 py-1">{profile.bio}</p>
            )}

            {/* Social links */}
            {profile.socialLinks && Object.values(profile.socialLinks).some(Boolean) && (
              <div className="flex flex-wrap gap-2 pt-1">
                {profile.socialLinks.telegram && (
                  <a href={profile.socialLinks.telegram} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 text-blue-500 rounded-lg text-xs font-medium hover:bg-blue-500/20 transition-colors">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
                    Telegram
                  </a>
                )}
                {profile.socialLinks.vk && (
                  <a href={profile.socialLinks.vk} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/10 text-blue-600 rounded-lg text-xs font-medium hover:bg-blue-600/20 transition-colors">
                    VK
                  </a>
                )}
                {profile.socialLinks.github && (
                  <a href={profile.socialLinks.github} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-neutral-500/10 text-neutral-600 dark:text-gray-400 rounded-lg text-xs font-medium hover:bg-neutral-500/20 transition-colors">
                    GitHub
                  </a>
                )}
                {profile.socialLinks.website && (
                  <a href={profile.socialLinks.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-500/10 text-violet-500 rounded-lg text-xs font-medium hover:bg-violet-500/20 transition-colors">
                    🌐 Сайт
                  </a>
                )}
              </div>
            )}
          </div>
        </motion.div>

        {/* Stats & Info row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Stats */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl p-5"
          >
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-white mb-3 flex items-center gap-2">
              <span className="text-base">📊</span> Статистика
            </h2>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Сообщений", value: profile.stats.messages, icon: "💬" },
                { label: "Друзей", value: profile.stats.friends, icon: "👥" },
                { label: "Игр", value: profile.stats.games, icon: "🎮" },
              ].map((stat) => (
                <div key={stat.label} className="bg-neutral-50 dark:bg-white/5 rounded-xl p-3 text-center border border-neutral-100 dark:border-white/5">
                  <p className="text-xs mb-1">{stat.icon}</p>
                  <p className="text-xl font-bold text-neutral-900 dark:text-white">{stat.value}</p>
                  <p className="text-[10px] text-neutral-500 dark:text-gray-500 mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-neutral-400 mt-3 flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              На платформе с {memberSince}
            </p>
          </motion.div>

          {/* Common groups */}
          {profile.commonGroups.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
              className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl p-5"
            >
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-white mb-3 flex items-center gap-2">
                <span className="text-base">🏠</span> Общие группы
              </h2>
              <div className="space-y-1.5">
                {profile.commonGroups.map((g) => (
                  <div key={g.id} className="flex items-center gap-2.5 px-3 py-2 bg-neutral-50 dark:bg-white/5 rounded-xl border border-neutral-100 dark:border-white/5 hover:border-violet-300 dark:hover:border-cyan-500/30 transition-colors">
                    {g.icon && g.icon.startsWith("/") ? (
                      <img src={g.icon} alt="" className="w-7 h-7 rounded-lg object-cover" />
                    ) : (
                      <span className="text-lg w-7 h-7 flex items-center justify-center">{g.icon || "💬"}</span>
                    )}
                    <span className="text-sm text-neutral-900 dark:text-white font-medium">{g.name}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>

        {/* Badges */}
        {profile.badges.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl p-5"
          >
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-white mb-3 flex items-center gap-2">
              <span className="text-base">🏆</span> Достижения
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {profile.badges.map((badge) => (
                <div key={badge.id} className={`rounded-xl border p-3 text-center hover:scale-[1.02] transition-transform ${RARITY_COLORS[badge.rarity] || RARITY_COLORS.common}`} title={badge.description}>
                  {badge.imageUrl ? (
                    <Image src={badge.imageUrl} alt={badge.name} width={48} height={48} className="w-12 h-12 mx-auto mb-2 object-contain" />
                  ) : (
                    <span className="text-3xl block mb-2">{badge.icon || "🏅"}</span>
                  )}
                  <p className="text-xs font-medium text-neutral-900 dark:text-white truncate">{badge.name}</p>
                  <p className="text-[10px] text-neutral-400 mt-0.5 truncate">{badge.description}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
