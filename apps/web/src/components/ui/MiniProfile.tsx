"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import GlowAvatar from "@/components/ui/GlowAvatar";
import { isOnline, timeAgo } from "@/lib/timeAgo";
import { bannerImgStyle } from "@/lib/bannerFraming"; // FIX-BGCROP

interface MiniProfileUser {
  id: string;
  name: string;
  username?: string;
  avatar: string | null;
  role: string;
  lastSeen?: string | null;
  avatarGlowEnabled?: boolean;
  avatarGlowColors?: string | null;
  profileBanner?: string | null;
}

interface MiniProfileProps {
  user: MiniProfileUser;
  children: React.ReactNode;
  onMessageClick?: (userId: string) => void;
  /** Which side to open the card: right (default) or left */
  side?: "right" | "left";
}

const ROLE_BADGE: Record<string, { label: string; color: string }> = {
  ADMIN:      { label: "Администратор", color: "text-red-500 dark:text-red-400" },
  EDITOR:     { label: "Редактор",      color: "text-amber-500 dark:text-amber-400" },
  MODERATOR:  { label: "Модератор",     color: "text-violet-500 dark:text-cyan-400" },
  CONSULTANT: { label: "Консультант",   color: "text-sky-500" },
  USER:       { label: "Участник",      color: "text-neutral-400" },
};

/** Отступ карточки от якоря и от краёв окна, px. */
const VIEWPORT_MARGIN = 8;

export default function MiniProfile({ user, children, onMessageClick, side = "right" }: MiniProfileProps) {
  const [visible, setVisible] = useState(false);
  // Позиция карточки. null — ещё не измерена (карточка отрисована невидимо).
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const online = isOnline(user.lastSeen ?? null);
  const badge = ROLE_BADGE[user.role] ?? ROLE_BADGE.USER;

  const show = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(true), 350);
  };
  const hide = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 120);
  };

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // Карточка позиционируется фиксированно относительно окна (а не абсолютно
  // внутри скролл-контейнера чата): она не добавляет прокручиваемое
  // пространство снизу и не «подпрыгивает» в начале истории. Позиция
  // вычисляется по фактическим размерам карточки: сначала пробуем открыть
  // вбок от аватара, а по вертикали — вниз от верхней кромки якоря; если
  // пикселей снизу не хватает, карточка открывается вверх и в любом случае
  // прижимается внутрь видимой области.
  useLayoutEffect(() => {
    if (!visible) {
      setPos(null);
      return;
    }
    const anchor = anchorRef.current;
    const card = cardRef.current;
    if (!anchor || !card) return;
    const a = anchor.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Горизонталь: предпочитаемая сторона, при нехватке места — зеркалим.
    let left = side === "left" ? a.left - c.width - VIEWPORT_MARGIN : a.right + VIEWPORT_MARGIN;
    if (left + c.width > vw - VIEWPORT_MARGIN) left = a.left - c.width - VIEWPORT_MARGIN;
    if (left < VIEWPORT_MARGIN) left = a.right + VIEWPORT_MARGIN;
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - c.width - VIEWPORT_MARGIN));

    // Вертикаль: вниз от верхней кромки якоря; если снизу не хватает
    // пикселей — открываем вверх (нижняя кромка карточки у нижней кромки
    // якоря), затем зажимаем в пределах окна.
    let top = a.top;
    if (top + c.height > vh - VIEWPORT_MARGIN) top = a.bottom - c.height;
    top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - c.height - VIEWPORT_MARGIN));

    setPos({ top, left });
  }, [visible, side]);

  return (
    <div ref={anchorRef} className="relative inline-block" onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        className="block rounded-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:focus-visible:ring-cyan-400"
        onClick={(event) => {
          event.stopPropagation();
          if (timerRef.current) clearTimeout(timerRef.current);
          setVisible((current) => !current);
        }}
        aria-label={`Открыть меню пользователя ${user.name}`}
        aria-expanded={visible}
      >
        {children}
      </button>

      <AnimatePresence>
        {visible && (
          <motion.div
            ref={cardRef}
            initial={{ opacity: 0, scale: 0.92, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 4 }}
            transition={{ type: "spring", damping: 22, stiffness: 320 }}
            onMouseEnter={show}
            onMouseLeave={hide}
            style={{
              position: "fixed",
              top: pos ? pos.top : 0,
              left: pos ? pos.left : 0,
              visibility: pos ? "visible" : "hidden",
            }}
            className="z-[85] w-56 rounded-2xl overflow-hidden shadow-2xl
              bg-white dark:bg-neutral-800
              border border-neutral-200 dark:border-white/10"
          >
            {/* Banner */}
            <div className="relative h-14 overflow-hidden bg-gradient-to-br from-violet-500/30 to-indigo-600/20 dark:from-cyan-500/20 dark:to-violet-600/20">
              {user.profileBanner && (
                <img
                  src={user.profileBanner}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  style={bannerImgStyle(user.profileBanner)}
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/25 to-transparent" />
            </div>

            <div className="px-3 pb-3 -mt-6">
              {/* Avatar */}
              <div className="mb-2">
                <GlowAvatar user={user} size={40} />
              </div>

              {/* Name + role */}
              <div className="mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-sm text-neutral-900 dark:text-white truncate">{user.name}</span>
                  {online && <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />}
                </div>
                {user.username && <div className="text-[11px] text-neutral-400">@{user.username}</div>}
                <div className={`text-[11px] font-medium mt-0.5 ${badge.color}`}>{badge.label}</div>
              </div>

              {/* Status */}
              <div className="text-[11px] text-neutral-500 mb-2.5">
                {online ? "В сети" : user.lastSeen ? `Был(а) ${timeAgo(user.lastSeen)}` : "Не в сети"}
              </div>

              {/* Actions */}
              <div className="space-y-1.5">
                {user.username && (
                  <button
                    onClick={() => {
                      router.push(`/profile/${encodeURIComponent(user.username!)}`); // PROFILE-WALL2
                      setVisible(false);
                    }}
                    className="w-full py-1.5 rounded-lg text-xs font-medium transition-all border border-neutral-200 dark:border-white/10 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.07]"
                  >
                    Открыть профиль
                  </button>
                )}
                {onMessageClick && (
                <button
                  onClick={() => { onMessageClick(user.id); setVisible(false); }}
                  className="w-full py-1.5 rounded-lg text-xs font-medium transition-all
                    bg-violet-600 dark:bg-cyan-500 text-white dark:text-neutral-900
                    hover:opacity-90"
                >
                  Написать
                </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
