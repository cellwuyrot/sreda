"use client";

import Image from "next/image";
import Link from "next/link";
import { ChatIcon } from "@/components/ui/ConnectIcons";
import PremiumMark from "@/components/connect/PremiumMark";
import MobileNotificationBell from "@/components/mobile/MobileNotificationBell";
import MobileProfileSheet from "@/components/mobile/MobileProfileSheet";
import { useState } from "react";

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
  /* MOBILE-VPN: вход в окно Premium и VPN. На телефоне левой панели нет, и до
     него было не добраться — в Android это выглядело как «функции VPN нет». */
  isPremium?: boolean;
  onOpenPremiumInfo?: () => void;
  /** FIX-NTF2: непрочитанные по сообществам: число, упоминания и список чатов. */
  groupUnread?: Record<string, { count: number; mention: boolean; channels: string[] }>;
}

export default function MobileGroupList({ groups, onSelectGroup, onCreateGroup, onJoinGroup, onOpenSearch, isPremium, onOpenPremiumInfo, groupUnread = {} }: MobileGroupListProps) {
  /* MOBILE-PROFILE: своё меню человека. На телефоне верхняя панель скрыта, и до
     профиля, уведомлений, рабочей среды и разделов по роли попасть было неоткуда. */
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <div className="flex-1 flex flex-col h-full bg-neutral-50 dark:bg-neutral-950">
      {/* MOBILE-UI: шапка — все кнопки с тач-таргетом от 44px */}
      <header className="px-4 py-2.5 border-b border-neutral-200 dark:border-white/5 flex items-center justify-between" style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top, 0px))" }}>
        {/* MOBILE-VPN: тот же значок «TZ», что и первым в левой панели на
            большом экране, — и с тем же действием. Панель на телефоне скрыта
            целиком, поэтому вход в Premium и VPN пропадал вместе с ней: в
            Android-оболочке это читалось как «функции VPN в приложении нет». */}
        <div className="flex items-center gap-2.5 min-w-0">
          {onOpenPremiumInfo && <PremiumMark isPremium={!!isPremium} onClick={onOpenPremiumInfo} size={36} />}
          <h1 className="text-xl font-bold text-neutral-900 dark:text-white truncate">TZ.Connect</h1>
        </div>
        <div className="flex items-center">
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

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
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
              className="w-full text-left px-3 py-2.5 min-h-[64px] bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-xl active:scale-[0.99] active:bg-neutral-50 dark:active:bg-neutral-800 transition-all flex items-center gap-3"
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

      {/* MOBILE-UI: нижние действия — кнопки 44px+; safe-area учитывает таб-бар ниже. */}
      <div className="p-3 border-t border-neutral-200 dark:border-white/5 flex gap-2">
        <button onClick={onCreateGroup} className="flex-1 btn-primary text-sm min-h-[44px]">Создать</button>
        <button onClick={onJoinGroup} className="flex-1 btn-secondary text-sm min-h-[44px]">Присоединиться</button>
        {/* MOBILE-PROFILE: здесь стояла кнопка «Друзья» — она повторяла раздел из
            нижней навигации, то есть занимала место и не давала ничего. На её
            месте вход в СВОИ разделы: профиль, уведомления, рабочая среда и
            разделы по роли (кабинет партнёра, редакторская, панель админа). До
            этого попасть туда с телефона было неоткуда. */}
        <button onClick={() => setProfileOpen(true)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center bg-amber-100 dark:bg-amber-400/10 text-amber-600 dark:text-amber-400 rounded-xl active:scale-95 transition-transform" aria-label="Профиль и разделы">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </button>
      </div>

      <MobileProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
