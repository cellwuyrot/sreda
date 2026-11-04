"use client";

import Image from "next/image";
import Link from "next/link";
import { ChatIcon } from "@/components/ui/ConnectIcons";
import PremiumMark from "@/components/connect/PremiumMark";
import MobileNotificationBell from "@/components/mobile/MobileNotificationBell";


interface Group {
  id: string;
  name: string;
  icon: string | null;
  description: string;
  isMain?: boolean;
  _count: { members: number; channels: number };
}

interface MobileGroupListProps {
  groups: Group[];
  onSelectGroup: (id: string) => void;
  onCreateGroup: () => void;
  onJoinGroup: () => void;
  /** MOBILE-UI: глобальный поиск — раньше на телефоне был недоступен вовсе. */
  onOpenSearch?: () => void;
  /* MOBILE-VPN: вход в окно Premium и надёжного соединения. На телефоне левой
     панели нет, и до него было не добраться — в Android это выглядело как
     «функции соединения в приложении нет». */
  isPremium?: boolean;
  onOpenPremiumInfo?: () => void;
  /** FIX-NTF2: непрочитанные по сообществам: число, упоминания и список чатов. */
  groupUnread?: Record<string, { count: number; mention: boolean; channels: string[] }>;
}

export default function MobileGroupList({ groups, onSelectGroup, onCreateGroup, onJoinGroup, onOpenSearch, isPremium, onOpenPremiumInfo, groupUnread = {} }: MobileGroupListProps) {


  return (
    <div className="flex-1 flex flex-col h-full bg-neutral-50 dark:bg-neutral-950">
      {/* MOBILE-UI: шапка — все кнопки с тач-таргетом от 44px */}
      <header className="px-4 py-2.5 border-b border-neutral-200 dark:border-white/5 flex items-center justify-between" style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top, 0px))" }}>
        {/* MOBILE-VPN: тот же значок «TZ», что и первым в левой панели на
            большом экране, — и с тем же действием. Панель на телефоне скрыта
            целиком, поэтому вход в Premium и соединение пропадал вместе с ней. */}
        <div className="flex items-center gap-2.5 min-w-0" data-android-hide="true">
          {/* NETLINK-2: клик сразу открывает большое окно. Промежуточная плашка на
              телефоне была вдвойне лишней: узкий экран, а шагов до действия два. */}
          {onOpenPremiumInfo && (
            <PremiumMark isPremium={!!isPremium} onClick={onOpenPremiumInfo} size={36} />
          )}

        </div>
        <div className="ml-auto flex items-center">
          {onOpenSearch && (
            <button
              onClick={onOpenSearch}
              className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-xl text-neutral-400 active:bg-neutral-100 dark:active:bg-white/5 transition-colors"
              aria-label="Поиск в TZ.Connect"
            >
              <svg width={21} height={21} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </button>
          )}
          {/* Колокольчик уведомлений — единственная точка входа в центр уведомлений
              на мобильном /connect (верхний Navbar здесь скрыт). */}
          <MobileNotificationBell />
          {/* ANDROID-LOCK: в Android-оболочке ссылки на лендинг нет —
              мессенджер живёт строго внутри /connect. */}
          <Link
            href="/"
            data-shell-hide="true"
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-xl text-neutral-400 active:bg-neutral-100 dark:active:bg-white/5 transition-colors"
            aria-label="На главную"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z" />
            </svg>
          </Link>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pt-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">Ваши сообщества</h2>
        {groups.length === 0 ? (
          <div className="text-center py-12">
            <span className="mb-4 flex justify-center"><ChatIcon size={48} tone="inactive" /></span>
            <p className="text-neutral-400 text-sm mb-4">Вы ещё не состоите в группах</p>
          </div>
        ) : (
          groups.map((g) => (
            <button
              key={g.id}
              onClick={() => onSelectGroup(g.id)}
              className="w-full text-left py-3 min-h-[72px] border-b border-neutral-200 dark:border-white/10 active:bg-neutral-100 dark:active:bg-white/5 transition-colors flex items-center gap-3"
            >
              <div className={`${g.isMain ? "w-12 h-12 ring-2 ring-violet-500/50 dark:ring-cyan-400/50" : "w-12 h-12"} rounded-xl bg-violet-100 dark:bg-cyan-400/10 flex items-center justify-center text-xl flex-shrink-0 overflow-hidden`}>
                {g.icon && g.icon.startsWith("/") ? (
                  <Image src={g.icon} alt={g.name} width={48} height={48} className="w-full h-full object-cover" />
                ) : (
                  <svg className="w-6 h-6 text-violet-500 dark:text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                  </svg>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-neutral-900 dark:text-white text-sm truncate">{g.name}</div>
                {g.description && <p className="text-[11px] text-neutral-400 truncate">{g.description}</p>}
                <div className="text-[10px] text-neutral-400 mt-0.5">
                  {g._count.members} участников &middot; {g._count.channels} каналов
                </div>
              </div>
              {/* FIX-NTF2: бейдж непрочитанных напротив сообщества (красный — упоминание) */}
              {(groupUnread[g.id]?.count ?? 0) > 0 && (
                <span
                  title={"Непрочитанные: " + (groupUnread[g.id]?.channels ?? []).join(", ")}
                  className={`min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold text-white inline-flex items-center justify-center flex-shrink-0 ${groupUnread[g.id]?.mention ? "bg-red-500" : "bg-violet-500 dark:bg-cyan-500"}`}
                >
                  {(groupUnread[g.id]?.count ?? 0) > 99 ? "99+" : groupUnread[g.id]?.count}
                </span>
              )}
              <svg className="w-4 h-4 text-neutral-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))
        )}
      </div>

      <div className="px-4 py-3 border-t border-neutral-200 dark:border-white/5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">Действия</p>
        <div className="flex gap-2">
          <button onClick={onCreateGroup} className="flex-1 min-h-[44px] text-sm text-left text-accent">＋ Создать сообщество</button>
          <button onClick={onJoinGroup} className="flex-1 min-h-[44px] text-sm text-left text-accent">Присоединиться →</button>
        </div>
      </div>
    </div>
  );
}
