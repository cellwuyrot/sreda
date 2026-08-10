"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { io, type Socket } from "socket.io-client";
import { BellIcon } from "@/components/ui/ConnectIcons";

/**
 * Мобильный колокольчик уведомлений.
 *
 * Верхняя панель (Navbar) с колокольчиком на мобильных полностью скрыта
 * (ConditionalNavbar → max-md:hidden), а нижняя мобильная навигация не показывается
 * внутри /connect. Из-за этого на телефоне не было ни бейджа непрочитанных, ни
 * входа в центр уведомлений. Этот компактный колокольчик закрывает пробел:
 * показывает счётчик и ведёт в центр уведомлений.
 *
 * Логика счётчика повторяет Navbar: стартовый запрос + live-обновления через
 * Socket.IO (new-notification / channel-read) и пересинхронизация при возврате
 * во вкладку.
 */
export default function MobileNotificationBell({ className = "" }: { className?: string }) {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    async function loadUnread() {
      try {
        const res = await fetch("/api/notifications?unread=true", { cache: "no-store" });
        if (res.ok) {
          const d = await res.json();
          if (!cancelled) setUnread(d.unreadCount ?? 0);
        }
      } catch {}
    }
    loadUnread();

    const socket: Socket = io({ path: "/api/socketio", withCredentials: true });
    socket.on("connect", () => socket.emit("join-dm", userId));
    socket.on("new-notification", () => setUnread((c) => c + 1));
    socket.on("channel-read", () => loadUnread());

    function resync() {
      if (document.visibilityState === "visible") loadUnread();
    }
    function onRead(e: Event) {
      const detail = (e as CustomEvent<{ unreadCount?: number }>).detail;
      if (detail && typeof detail.unreadCount === "number") setUnread(Math.max(0, detail.unreadCount));
      else setUnread(0);
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

  if (!userId) return null;

  return (
    <Link
      href="/settings/notifications"
      data-shell-hide="true"
      className={`relative min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-xl text-neutral-500 dark:text-neutral-400 active:bg-neutral-100 dark:active:bg-white/5 transition-colors ${className}`}
      aria-label={unread > 0 ? `Уведомления, непрочитанных: ${unread}` : "Уведомления"}
    >
      <BellIcon size={20} />
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
