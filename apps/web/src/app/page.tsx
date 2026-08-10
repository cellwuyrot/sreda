"use client";

import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, useMemo, useRef } from "react";
import { useSession, signOut } from "next-auth/react";
import { useInlineEdit } from "@/components/InlineEditContext";
import EditableText from "@/components/EditableText";

/* ─────────────── Types ─────────────── */

interface WindowData {
  id: string;
  windowKey: string;
  title: string;
  subtitle: string;
  description: string;
  href: string;
  accentColor: string;
  backgroundUrl: string | null;
  backgroundType: string;
  gradientFrom: string;
  gradientTo: string;
}

/* ─────────────── Particle System ─────────────── */

function useParticles(count: number, seed: number) {
  return useMemo(() => {
    const particles = [];
    for (let i = 0; i < count; i++) {
      const s = seed + i * 137.508;
      particles.push({
        id: i,
        x: (s * 7919) % 100,
        y: (s * 104729) % 100,
        size: 1.5 + ((s * 31) % 3),
        delay: (i * 0.4) % 6,
        duration: 5 + ((s * 13) % 8),
      });
    }
    return particles;
  }, [count, seed]);
}

/* ─────────────── Window Background Animation ─────────────── */

function WindowAnimation({ accentColor, seed }: { accentColor: string; seed: number }) {
  const particles = useParticles(6, seed);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{
            width: p.size,
            height: p.size,
            left: `${p.x}%`,
            top: `${p.y}%`,
            backgroundColor: accentColor,
          }}
          animate={{
            y: [0, -40, -80],
            opacity: [0, 0.4, 0],
            scale: [0.5, 1, 0.3],
          }}
          transition={{
            duration: p.duration,
            repeat: Infinity,
            delay: p.delay,
            ease: "easeOut",
          }}
        />
      ))}
    </div>
  );
}

/* ─────────────── Window Card ─────────────── */

function WindowCard({ window, index }: { window: WindowData; index: number }) {
  const [hovered, setHovered] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const seeds = [42, 77, 123, 99];
  const isTopRow = index < 2;

  const bgStyle = window.backgroundType === "video" && window.backgroundUrl
    ? {}
    : {
        background: `linear-gradient(135deg, ${window.gradientFrom} 0%, ${window.gradientTo} 100%)`,
      };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 10;   // -5 to +5 deg
    const y = ((e.clientY - rect.top)  / rect.height - 0.5) * -10;  // flip Y
    setTilt({ x, y });
  };

  const handleMouseLeave = () => {
    setHovered(false);
    setTilt({ x: 0, y: 0 });
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.8, delay: index * 0.15, ease: [0.25, 0.1, 0.25, 1] }}
      className="relative h-full"
      style={{ perspective: 800 }}
    >
      <Link href={window.href} className="block h-full">
        <motion.div
          ref={cardRef}
          className="relative w-full h-full min-h-[200px] overflow-hidden cursor-pointer group"
          style={{
            ...bgStyle,
            transformStyle: "preserve-3d",
            rotateX: tilt.y,
            rotateY: tilt.x,
          }}
          animate={{
            scale: hovered ? 1.025 : 1,
            rotateX: tilt.y,
            rotateY: tilt.x,
          }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          onMouseEnter={() => setHovered(true)}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {window.backgroundType === "video" && window.backgroundUrl && (
            <motion.video
              autoPlay muted loop playsInline
              className="absolute inset-0 w-full h-full object-cover"
              src={window.backgroundUrl}
              animate={{ scale: hovered ? 1.06 : 1 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          )}

          {window.backgroundType === "image" && window.backgroundUrl && (
            <motion.div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${window.backgroundUrl})` }}
              animate={{ scale: hovered ? 1.06 : 1 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          )}

          <WindowAnimation accentColor={window.accentColor} seed={seeds[index] || 42} />

          {/* Layered gradient — bottom text mask stays, top vignette lifts on hover */}
          <motion.div
            className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent"
            animate={{ opacity: hovered ? 0.8 : 1 }}
            transition={{ duration: 0.35 }}
          />

          {/* Liquid-glass frosted strip behind the label for legibility */}
          <div
            className="absolute inset-x-0 bottom-0 h-2/5 pointer-events-none backdrop-blur-[3px]"
            style={{ WebkitMaskImage: "linear-gradient(to top, black 35%, transparent)", maskImage: "linear-gradient(to top, black 35%, transparent)" }}
          />

          {/* Subtle edge glow on hover */}
          <motion.div
            className="absolute inset-0 pointer-events-none rounded-[inherit]"
            style={{
              boxShadow: `inset 0 0 40px ${window.accentColor}22`,
            }}
            animate={{ opacity: hovered ? 1 : 0 }}
            transition={{ duration: 0.4 }}
          />

          <div className={`relative z-10 flex flex-col justify-end h-full p-4 sm:p-6 ${isTopRow ? "max-md:pb-20" : ""}`}>
            <motion.div animate={{ y: hovered ? -3 : 0 }} transition={{ duration: 0.3, ease: "easeOut" }}>
              <EditableText
                contentKey={`window.${window.windowKey}.title`}
                defaultValue={window.title}
                tag="h3"
                className="text-lg sm:text-xl md:text-2xl font-display font-bold text-white mb-1 [text-shadow:_0_1px_4px_rgb(0_0_0_/_0.85)]"
              />
            </motion.div>

            <motion.div
              animate={{ opacity: hovered ? 1 : 0.9, y: hovered ? 0 : 4 }}
              transition={{ duration: 0.3 }}
            >
              <EditableText
                contentKey={`window.${window.windowKey}.subtitle`}
                defaultValue={window.subtitle}
                tag="p"
                className="text-gray-100 text-xs sm:text-sm font-medium [text-shadow:_0_1px_3px_rgb(0_0_0_/_0.9)]"
              />
            </motion.div>
          </div>
        </motion.div>
      </Link>
    </motion.div>
  );
}

/* ─────────────── Center Logo Button ─────────────── */

function CenterLogoButton() {
  const [hovered, setHovered] = useState(false);
  /* Эмблема лежит в public и попадает в репозиторий отдельно от кода. Пока
     файла нет, кнопка показывает прежний логотип: ломаный значок в самом
     центре главной был бы худшим из исходов. */
  const [emblemFailed, setEmblemFailed] = useState(false);

  return (
    <Link href="/about">
      <motion.div
        className="relative cursor-pointer"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1, delay: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
      >
        {/* Glow behind logo */}
        <motion.div
          className="absolute blur-2xl"
          style={{ inset: -16 }}
          animate={{
            background: hovered
              ? "radial-gradient(circle, rgba(100,200,255,0.35) 0%, transparent 70%)"
              /* Свечение в покое поднято с 0.03: эмблема тёмная, металлическая,
                 и на тёмных плитках без подсветки она сливалась бы с фоном.
                 Прежнему белому логотипу подсветка была не нужна. */
              : "radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 70%)",
          }}
          transition={{ duration: 0.4 }}
        />

        {/* Logo image */}
        {/* Коробка на шаг крупнее прежней: у медальона прозрачные углы, и в
            старом размере он читался бы мельче белой плитки, которая занимала
            квадрат целиком. */}
        <motion.div
          className="relative w-28 h-28 sm:w-32 sm:h-32 md:w-36 md:h-36"
          animate={
            hovered
              ? { rotate: [0, 4, -4, 3, -3, 0], scale: 1.05 }
              : { rotate: 0, scale: 1 }
          }
          transition={
            hovered
              ? { rotate: { duration: 2.5, repeat: Infinity, ease: "easeInOut" }, scale: { duration: 0.4 } }
              : { duration: 0.4 }
          }
          style={{
            filter: hovered
              ? "drop-shadow(0 0 20px rgba(100,200,255,0.5)) drop-shadow(0 0 40px rgba(100,200,255,0.2))"
              : "drop-shadow(0 0 8px rgba(0,0,0,0.5))",
          }}
        >
          <Image
            src={emblemFailed ? "/logo.png" : "/brand/tz-emblem.png"}
            alt="TrioZ"
            fill
            className="object-contain"
            onError={() => setEmblemFailed(true)}
            priority
          />
        </motion.div>
      </motion.div>
    </Link>
  );
}

/* ─────────────── User Menu Overlay ─────────────── */

function UserMenu() {
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const { editMode, toggleEditMode, isAdmin } = useInlineEdit();

  return (
    <div className="flex items-center gap-2">
      {isAdmin && (
        <button
          onClick={toggleEditMode}
          className={`p-2 rounded-xl transition-all ${
            editMode
              ? "bg-cyan-500 text-white shadow-lg shadow-cyan-500/30"
              : "text-gray-400 hover:text-white hover:bg-white/10"
          }`}
          title={editMode ? "Выключить редактирование" : "Редактировать сайт"}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
      )}

      {!session ? (
        <Link href="/auth/signin">
          <motion.button
            className="px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300
              border border-white/10 text-gray-300 hover:text-cyan-400 hover:border-cyan-400/40
              hover:shadow-[0_0_20px_rgba(0,240,255,0.15)] backdrop-blur-xl bg-black/30"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            Войти
          </motion.button>
        </Link>
      ) : (
        <div className="relative">
          <motion.button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm
              border border-white/10 text-gray-300 backdrop-blur-xl bg-black/30
              hover:border-cyan-400/30 transition-all duration-300"
            whileHover={{ scale: 1.02 }}
          >
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-400/30 to-indigo-500/30 flex items-center justify-center">
              <span className="text-[10px] font-bold text-white">
                {session.user?.name?.charAt(0) || "U"}
              </span>
            </div>
            <span className="hidden sm:inline text-xs">{session.user?.name}</span>
            <svg className={`w-3 h-3 transition-transform ${menuOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </motion.button>

          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-white/10 bg-neutral-900/95 backdrop-blur-xl shadow-2xl overflow-hidden z-50"
              >
                <div className="p-3 border-b border-white/5">
                  <p className="text-xs text-gray-400">Вы вошли как</p>
                  <p className="text-sm text-white font-medium truncate">{session.user?.name}</p>
                  <p className="text-[10px] text-gray-500 truncate">{session.user?.email}</p>
                </div>

                <div className="p-1">
                  {(session.user as { role?: string })?.role === "ADMIN" && (
                    <Link
                      href="/admin"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-amber-400 hover:bg-white/5 rounded-lg transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      Админ-панель
                    </Link>
                  )}

                  <Link
                    href="/projects"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                    </svg>
                    Проекты
                  </Link>

                  <button
                    onClick={() => { signOut(); setMenuOpen(false); }}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-white/5 rounded-lg transition-colors w-full text-left"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Выйти
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

/* ─────────────── Fallback windows ─────────────── */

// Shown whenever `/api/windows` is unreachable, errors, or returns an empty
// list. They mirror the four rows the seed script creates, so the landing grid
// is never blank — the web build stays in sync with a freshly-loaded desktop
// client regardless of the backend/DB state.
const FALLBACK_WINDOWS: WindowData[] = [
  {
    id: "1", windowKey: "trioz", title: 'Проекты Т.Р.И.О."Z"',
    subtitle: "MMORPG • Стратегии • Онлайн",
    description: "Глобальная MMORPG с элементами стратегии и бесконечным миром",
    href: "/projects", accentColor: "#ff4444", backgroundUrl: null,
    backgroundType: "gradient", gradientFrom: "#1a0000", gradientTo: "#0a0a0f",
  },
  {
    id: "2", windowKey: "pero", title: "Перо Измерений",
    subtitle: "Книги • Настольные игры • Офлайн",
    description: "Развлекательные товары для развития мышления",
    href: "/pero", accentColor: "#8b5cf6", backgroundUrl: null,
    backgroundType: "gradient", gradientFrom: "#1a002e", gradientTo: "#0a0a0f",
  },
  {
    id: "3", windowKey: "connect", title: "TZ.Connect",
    subtitle: "Связь • IT-услуги • Бизнес",
    description: "Коммуникационная платформа и IT-решения",
    href: "/connect", accentColor: "#00f0ff", backgroundUrl: null,
    backgroundType: "gradient", gradientFrom: "#001a1f", gradientTo: "#0a0a0f",
  },
  {
    id: "4", windowKey: "library", title: "TZ.Library",
    subtitle: "Лор • Вики • История",
    description: "Хранилище знаний и лора вселенной",
    href: "/library", accentColor: "#10b981", backgroundUrl: null,
    backgroundType: "gradient", gradientFrom: "#001a0e", gradientTo: "#0a0a0f",
  },
];

/* ─────────────── Main Page ─────────────── */

export default function HomePage() {
  // Seed the grid with the fallback windows so all four cards paint on the very
  // first render. Previously the state started empty and the 2×2 grid stayed
  // blank until `/api/windows` resolved, which made the landing screen look like
  // it was hanging while the cards trickled in. The DB response replaces these
  // once it arrives (see the effect below).
  const [windows, setWindows] = useState<WindowData[]>(FALLBACK_WINDOWS);

  useEffect(() => {
    fetch("/api/windows")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        // A 200 response can still carry an empty array (unseeded DB) or a
        // non-array error payload. In either case fall back to the defaults so
        // the grid is never empty.
        setWindows(Array.isArray(data) && data.length > 0 ? data : FALLBACK_WINDOWS);
      })
      .catch(() => setWindows(FALLBACK_WINDOWS));
  }, []);

  return (
    <div className="fixed inset-0 bg-neutral-950 overflow-hidden">
      {/* Top right: Auth button + Theme toggle */}
      <div className="fixed top-4 right-4 z-50">
        <UserMenu />
      </div>

      {/* 4 Windows Grid — 2×2, fills screen, no scroll */}
      <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-[1px]" style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
        {windows.map((win, i) => (
          // Key by the stable `windowKey` (shared by the fallback and DB rows)
          // instead of the DB id, so swapping fallback → DB data updates the
          // existing cards in place rather than remounting them and replaying
          // the entrance animation.
          <div key={win.windowKey} className="relative overflow-hidden">
            <WindowCard window={win} index={i} />
          </div>
        ))}
      </div>

      {/* Center Logo Button */}
      <div className="fixed inset-0 flex items-center justify-center z-40 pointer-events-none">
        <div className="pointer-events-auto">
          <CenterLogoButton />
        </div>
      </div>
    </div>
  );
}
