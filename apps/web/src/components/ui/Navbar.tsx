"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { unregisterShellPushDevice } from "@/hooks/usePushDevice";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";
import { useTheme } from "@/components/Providers";
import { notifyExternal } from "@/lib/appNotify"; // ANDROID-NOTIFY
import { loadNotifyPrefs } from "@/lib/notifyPrefs";
import { useInlineEdit } from "@/components/InlineEditContext";
import { Sun, Moon, SquarePen, ChevronDown, LogOut, Menu, X } from "lucide-react";
import { BellIcon, GearIcon, BellOffIcon } from "@/components/ui/ConnectIcons"; // FIX-ICONS: + BellOffIcon (SVG вместо PNG)
import { io, type Socket } from "socket.io-client";
import { isDesktop } from "@/lib/desktop";
import { playDMNotification } from "@/lib/dmSound";



export default function Navbar() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const accountRole = (session?.user as { role?: string } | undefined)?.role;
  const [unread, setUnread] = useState(0);
  const [dmToast, setDmToast] = useState<{ title: string; body: string } | null>(null);

  /* FIX-DM-NTF: какой диалог сейчас открыт на экране.

     Шапка живёт выше раздела сообщений и про его состояние ничего не знает,
     поэтому DMPanel сам сообщает об открытой переписке событием окна — так же,
     как сделано с tz-notifications-read. Храним в ref, а не в состоянии: значение
     читается внутри обработчика сокета, и переподписывать сокет на каждую смену
     диалога нельзя. */
  const activeDmRef = useRef<{ conversationId: string | null; peerId: string | null }>({
    conversationId: null,
    peerId: null,
  });

  useEffect(() => {
    function onActiveDm(e: Event) {
      const detail = (e as CustomEvent<{ conversationId?: string | null; peerId?: string | null }>).detail;
      activeDmRef.current = {
        conversationId: detail?.conversationId ?? null,
        peerId: detail?.peerId ?? null,
      };
    }
    window.addEventListener("tz-dm-active", onActiveDm);
    return () => window.removeEventListener("tz-dm-active", onActiveDm);
  }, []);

  // Счётчик непрочитанных уведомлений (колокольчик у ника)
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    // Всегда тянем свежий счётчик с сервера (без HTTP-кэша браузера), иначе
    // бейдж может «залипнуть» на устаревшем значении.
    async function loadUnread() {
      try {
        const res = await fetch("/api/notifications?unread=true", { cache: "no-store" });
        if (res.ok) {
          const d = await res.json();
          if (cancelled) return;
          const count = d.unreadCount ?? 0;
          setUnread(count);
          /* FIX-NTF-READ: то же число нужно не только бейджу. Полоса состояния
             десктопной оболочки (preload/statusBar) живёт вне React и слушает это
             же событие — иначе прочитанное на другом устройстве оставалось бы
             висеть внизу окна. Один источник правды о непрочитанном, один канал. */
          window.dispatchEvent(new CustomEvent("tz-notifications-read", { detail: { unreadCount: count } }));
        }
      } catch {}
    }
    loadUnread();
    /* Настройки уведомлений нужны в обработчиках сокета ниже — там сетевого
       похода быть не должно, поэтому забираем их заранее, один раз. */
    void loadNotifyPrefs();

    const socket: Socket = io({ path: "/api/socketio", withCredentials: true });
    socket.on("connect", () => socket.emit("join-dm", userId));
    socket.on("account-session-revoked", () => {
      // The server has already invalidated the fresh ban cache. Reload into the
      // restricted appeal-only session before it closes all realtime sockets.
      window.location.reload();
    });
    socket.on("account-role-updated", () => window.location.reload());
    /* isNew === false — уведомление сгруппировано с уже висящим непрочитанным
       (ещё одно сообщение из того же чата). Новой строки в журнале не появилось,
       поэтому и счётчик непрочитанных расти не должен: беседа как была одной
       непрочитанной, так и осталась. Растёт бейдж только на действительно новое. */
    socket.on("new-notification", (payload?: { isNew?: boolean }) => {
      if (payload?.isNew === false) return;
      setUnread((c) => c + 1);
    });
    // This listener lives in the global navbar rather than DMPanel, so an
    // incoming personal message is announced even while the recipient is in a
    // group, friends view, settings, or another conversation.
    socket.on("dm-message", (payload: {
      userId?: string;
      content?: string;
      pushEnabled?: boolean;
      conversationId?: string;
      user?: { name?: string; username?: string };
    }) => {
      if (payload.userId === userId) return; // server also echoes to sender

      /* FIX-DM-NTF: не уведомляем о сообщении в том диалоге, который человек
         сейчас читает: сообщение уже появилось в переписке у него на глазах, и
         тост со звуком поверх него — шум, а не извещение.

         Сверка идёт и по разговору, и по собеседнику: в событии есть оба признака,
         но у только что созданной переписки на клиенте может ещё не быть идентификатора.

         Условие по document.hidden обязательно: диалог может быть открыт, но
         приложение свёрнуто — тогда человек ничего не видит и известить его надо. */
      const activeDm = activeDmRef.current;
      const inThisDialog =
        (!!payload.conversationId && activeDm.conversationId === payload.conversationId) ||
        (!!payload.userId && activeDm.peerId === payload.userId);
      if (inThisDialog && !document.hidden) return;
      if (isDesktop()) return; // Electron's main-process bridge owns its toast
      const title = payload.user?.name || payload.user?.username || "Личное сообщение";
      const body = payload.content?.startsWith("e2ee:")
        ? "Зашифрованное сообщение"
        : (payload.content || "Новое сообщение").slice(0, 120);
      playDMNotification();
      setDmToast({ title, body });
      window.setTimeout(() => setDmToast(null), 4500);
      /* ANDROID-NOTIFY: см. lib/appNotify — в оболочке уведомление показывает
         Android, в браузере остаётся Web Notification. */
      if (payload.pushEnabled !== false && document.hidden) {
        notifyExternal(title, body, `dm-${payload.userId || "message"}`);
      }
    });
    // Канал прочитан (на любом устройстве) — пересчитать бейдж сразу,
    // не дожидаясь фокуса/видимости вкладки
    socket.on("channel-read", () => loadUnread());

    // Пересинхронизация при возвращении в приложение: вкладка снова видима или
    // окно получило фокус. Так бейдж «самоизлечивается», если уведомления были
    // прочитаны в другой вкладке, на другом устройстве или в десктоп-клиенте.
    function resync() {
      if (document.visibilityState === "visible") loadUnread();
    }
    // Точечное обновление в пределах текущей вкладки: страница уведомлений
    // сообщает актуальный остаток непрочитанных, а не всегда обнуляет счётчик.
    function onRead(e: Event) {
      const detail = (e as CustomEvent<{ unreadCount?: number }>).detail;
      if (detail && typeof detail.unreadCount === "number") {
        setUnread(Math.max(0, detail.unreadCount));
      } else {
        setUnread(0);
      }
    }
    window.addEventListener("tz-notifications-read", onRead);
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("focus", resync);
    return () => {
      cancelled = true;
      socket.disconnect();
      window.removeEventListener("tz-notifications-read", onRead);
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("focus", resync);
    };
  }, [userId]);
  const [menuOpen, setMenuOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { editMode, toggleEditMode, isAdmin } = useInlineEdit();
  const pathname = usePathname();

  // The Electron desktop shell is a dedicated TZ.Connect client. The top-bar
  // cross-section links (Главная, T.R.I.O.Z., Перо измерений, Игры, TZ.Library)
  // have no place there, and even the lone "TZ.Connect" link is redundant: the
  // user is *already* inside TZ.Connect, so the label reads like a stray section
  // heading. Inside the shell we therefore hide every top-bar link and keep only
  // the right-hand controls (search, theme, notifications, profile menu).
  // `window.triozDesktop` is injected by the shell's preload, so it is absent in
  // a normal browser. Detection runs in an effect (never during SSR/first paint)
  // to keep the server-rendered markup and the initial client render identical.
  const [desktopShell, setDesktopShell] = useState(false);
  useEffect(() => setDesktopShell(isDesktop()), []);

  // Close mobile menu on route change
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const navLinks = [
    { href: "/", label: "Главная" },
    { href: "/connect", label: "TZ.Connect" },
    { href: "/projects", label: "T.R.I.O.Z." },
    { href: "/pero", label: "Перо измерений" },
    { href: "/games", label: "Игры" },
    { href: "/library", label: "TZ.Library" },
  ];

  // Inside the desktop shell hide the section links entirely (see note above);
  // the browser keeps the full ecosystem navigation.
  const visibleLinks = desktopShell ? [] : navLinks;

  /** Exact match for "/" only, prefix match for everything else */
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-xl border-b border-neutral-200 dark:border-white/5">
      <div className={`tz-navbar-inner ${desktopShell ? "w-full" : "max-w-7xl mx-auto"} px-4 sm:px-6 lg:px-8`}>
        <div className="flex items-center justify-between h-16">
          {/* Navigation links */}
          <div className="tz-web-only hidden md:flex items-center gap-0.5">
            {visibleLinks.map((link) => {
              const active = isActive(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`relative px-3 py-2 text-sm rounded-lg transition-all duration-200 ${
                    active
                      ? "text-accent font-medium"
                      : "text-neutral-600 dark:text-gray-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/5"
                  }`}
                >
                  {link.label}
                  {active && (
                    <motion.span
                      layoutId="nav-indicator"
                      className="absolute inset-0 rounded-lg bg-violet-50 dark:bg-cyan-400/10 -z-10"
                      transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                    />
                  )}
                </Link>
              );
            })}
          </div>

          {/* Right side — pinned to the far left inside the desktop shell so the
              controls (Редактировать, уведомления, Админ, имя) don't float
              near the centre of a wide window. */}
          <div className={`tz-navbar-right flex items-center gap-2 ${desktopShell ? "mr-auto" : "ml-auto"}`}>
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg text-neutral-500 dark:text-gray-400 hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors"
              title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
            >
              {theme === "dark" ? (
                <Sun className="w-5 h-5" strokeWidth={2} />
              ) : (
                <Moon className="w-5 h-5" strokeWidth={2} />
              )}
            </button>

            {session ? (
              <div className="flex items-center gap-2">
                {accountRole === "CONSULTANT" && (
                  <Link
                    href="/partner"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500/10 px-3 py-1.5 text-sm font-medium text-violet-600 transition hover:bg-violet-500/15 dark:bg-cyan-500/10 dark:text-cyan-400 dark:hover:bg-cyan-500/15"
                    title="Личный кабинет"
                  >
                    <span aria-hidden>◇</span>
                    <span className="hidden sm:inline">Личный кабинет</span>
                  </Link>
                )}
                {accountRole === "EDITOR" && (
                  <Link
                    href="/editor"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-600 transition hover:bg-amber-500/15 dark:text-amber-400"
                    title="Редакторская"
                  >
                    <SquarePen className="h-4 w-4" strokeWidth={2} />
                    <span className="hidden sm:inline">Редакторская</span>
                  </Link>
                )}
                {isAdmin && (
                  <button
                    onClick={toggleEditMode}
                    className={`text-sm px-3 py-1.5 rounded-lg transition-all duration-300 flex items-center gap-1.5 ${
                      editMode
                        ? "bg-violet-500 dark:bg-cyan-500 text-white shadow-lg shadow-violet-500/30 dark:shadow-cyan-500/30"
                        : "text-neutral-500 dark:text-gray-400 hover:text-violet-600 dark:hover:text-cyan-400 hover:bg-neutral-100 dark:hover:bg-white/5"
                    }`}
                  >
                    <SquarePen className="w-4 h-4" strokeWidth={2} />
                    <span className="hidden sm:inline">{editMode ? "Редактирование" : "Редактировать"}</span>
                  </button>
                )}
                {isAdmin && (
                  <Link
                    href="/admin"
                    className="text-sm text-amber-600 dark:text-fantasy-gold hover:text-amber-500 dark:hover:text-yellow-300 transition-colors"
                  >
                    Админ
                  </Link>
                )}

                {/* Колокольчик уведомлений — это центр уведомлений (входящие),
                    поэтому он виден всегда. Настройка «Push-уведомления» отключает
                    лишь нативные системные тосты, но не доступ к истории и бейджу. */}
                <Link
                  href="/settings/notifications"
                  className="relative p-2 rounded-lg text-neutral-500 dark:text-gray-400 hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors"
                  title="Уведомления"
                >
                  <BellIcon size={20} />
                  {unread > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </Link>

                {/* User menu with hover dropdown */}
                <div className="relative group hidden sm:block">
                  <button className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors">
                    <span className="text-sm text-neutral-500 dark:text-gray-400">{session.user?.name}</span>
                    <ChevronDown className="w-3 h-3 text-neutral-400" strokeWidth={2} />
                  </button>

                  {/* Dropdown — FIX-B4: pt-1 вместо mt-1, чтобы курсор не «проваливался»
                      в зазор между кнопкой и меню; group-focus-within открывает меню с клавиатуры */}
                  <div className="absolute right-0 top-full pt-1 w-44 opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-all duration-150 z-50">
                  <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-xl shadow-lg overflow-hidden">
                    <Link
                      href="/settings/notifications"
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-neutral-700 dark:text-gray-300 hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors"
                    >
                      <BellOffIcon size={18} style={{ color: "inherit" }} />
                      Уведомления
                    </Link>
                    <Link
                      href="/settings"
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-neutral-700 dark:text-gray-300 hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors"
                    >
                      <GearIcon size={18} style={{ color: "inherit" }} />
                      Настройки профиля
                    </Link>
                    <Link
                      href="/workspace"
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-neutral-700 dark:text-gray-300 hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors"
                    >
                      <svg
                        className="w-5 h-5 text-neutral-500 dark:text-gray-400"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <path d="M3 9h18M9 21V9" />
                      </svg>
                      Рабочая среда
                    </Link>
                    <div className="border-t border-neutral-100 dark:border-white/5" />
                    <button
                      onClick={() => {
                        /* PUSH: снимаем устройство до выхода. Иначе на телефоне
                           остался бы адрес, привязанный к прежнему человеку, и
                           уведомления шли бы ему до следующего входа. */
                        void unregisterShellPushDevice().finally(() => signOut());
                      }}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/5 transition-colors"
                    >
                      <LogOut className="w-4 h-4" strokeWidth={2} />
                      Выйти
                    </button>
                  </div>
                  </div>
                </div>

                {/* Mobile: simple sign out */}
                <button
                  onClick={() => {
                        /* PUSH: снимаем устройство до выхода. Иначе на телефоне
                           остался бы адрес, привязанный к прежнему человеку, и
                           уведомления шли бы ему до следующего входа. */
                        void unregisterShellPushDevice().finally(() => signOut());
                      }}
                  className="sm:hidden text-sm text-neutral-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                >
                  Выход
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link href="/auth/signin" className="btn-secondary text-sm !px-4 !py-2">
                  Войти
                </Link>
              </div>
            )}

            {visibleLinks.length > 0 && (
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="md:hidden p-2 text-neutral-500 dark:text-gray-400 hover:text-neutral-900 dark:hover:text-white"
            >
              {menuOpen ? (
                <X className="w-6 h-6" strokeWidth={2} />
              ) : (
                <Menu className="w-6 h-6" strokeWidth={2} />
              )}
            </button>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl border-b border-neutral-200 dark:border-white/5"
          >
            <div className="px-4 py-3 space-y-1">
              {visibleLinks.map((link) => {
                const active = isActive(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className={`block px-3 py-2 rounded-lg transition-colors text-sm ${
                      active
                        ? "bg-violet-50 dark:bg-cyan-400/10 text-accent font-medium"
                        : "text-neutral-700 dark:text-gray-300 hover:text-violet-600 dark:hover:text-cyan-400 hover:bg-neutral-50 dark:hover:bg-white/5"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {dmToast && (
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            className="fixed right-4 top-[calc(var(--tz-navbar-h,64px)+12px)] z-[120] w-[min(340px,calc(100vw-2rem))] rounded-2xl border border-neutral-200 bg-white/95 px-4 py-3 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-neutral-900/95"
          >
            <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">{dmToast.title}</p>
            <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">{dmToast.body}</p>
          </motion.div>
        )}
      </AnimatePresence>

    </nav>
  );
}
