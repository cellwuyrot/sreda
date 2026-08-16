"use client";

import { memo } from "react";
import ConnectionMenu from "@/components/connect/overlays/ConnectionMenu";
import type { GlowAvatarUser } from "@/components/ui/GlowAvatar";
import { CommunitiesIcon, FriendsIcon, MessagesIcon, MicIcon, GearIcon, ShieldIcon } from "@/components/ui/ConnectIcons";

export type NavSection = "communities" | "friends" | "dm" | "business";

interface NavRailProps {
  activeSection: NavSection;
  onChangeSection: (s: NavSection) => void;
  /** Показывать ли раздел «Бизнес» (деловые чаты) */
  showBusiness?: boolean;
  myProfileUser: GlowAvatarUser;
  userName: string;
  userUsername: string;
  onProfileSettings: () => void;
  /** Открыть всплывающее окно TZ.AI (кнопка над настройками) */
  onOpenAi?: () => void;
  isPremium?: boolean;
  onOpenPremiumInfo?: () => void;
  onOpenSearch?: () => void;
  /** optional: show mic active state */
  micActive?: boolean;
  onToggleMic?: () => void;
}

/* ── Icons ─────────────────────────────────────────────────────────────── */
// All icons are now imported from @/components/ui/ConnectIcons (flat, minimalist, tone-aware).

/* ── NavSection tooltip labels ─────────────────────────────────────────── */
// Icons use tone="inactive"; the active section's color is driven by the `.cn-nav-btn.active`
// CSS class (which sets color: var(--cn-accent-text)), inherited via currentColor.
const BASE_SECTIONS: { key: NavSection; label: string; icon: React.ReactNode }[] = [
  { key: "communities", label: "Сообщества", icon: <CommunitiesIcon size={22} tone="inactive" /> },
  { key: "friends",     label: "Друзья",      icon: <FriendsIcon size={22} tone="inactive" /> },
  { key: "dm",          label: "Сообщения",   icon: <MessagesIcon size={22} tone="inactive" /> },
];

/* Подпись «Бизнес чат», а не «Бизнес»: раздел один на клиента и администрацию,
   и человеку важно понимать, что за иконкой разговор по его заявке, а не ещё
   один список личных сообщений. Иконку не меняем. */
const BUSINESS_SECTION: { key: NavSection; label: string; icon: React.ReactNode } = {
  key: "business",
  label: "Бизнес чат",
  icon: <ShieldIcon size={22} tone="inactive" />,
};

/* ══════════════════════════════════════════════════════════════════════════ */

// FIX-PERF: NavRail оборачиваем в memo — при мемоизированных пропсах
// (стабильные колбэки + memo-объект myProfileUser) он не перерисовывается на
// каждый рендер /connect.
function NavRail({
  activeSection,
  onChangeSection,
  myProfileUser: _myProfileUser,
  userName: _userName,
  userUsername: _userUsername,
  onProfileSettings,
  onOpenAi,
  isPremium,
  onOpenPremiumInfo,
  onOpenSearch,
  micActive,
  onToggleMic,
  showBusiness,
}: NavRailProps) {
  const sections = showBusiness ? [...BASE_SECTIONS, BUSINESS_SECTION] : BASE_SECTIONS;
  return (
    <nav
      className="cn-rail flex-shrink-0 flex flex-col items-center max-md:hidden"
      style={{ width: 68, paddingTop: 12, paddingBottom: 12 }}
      aria-label="Основная навигация"
    >
      {/* ── Кнопка «TZ» ──
          NETLINK: теперь это полноценное управление соединением, а не только
          вход в окно: состояние, тариф, остаток трафика, срок и выбор сервера.
          Раскраска значка по-прежнему живёт в PremiumMark — тот же значок стоит
          в шапке на телефоне, где этой панели нет вовсе. */}
      <div className="mb-2">
        <ConnectionMenu isPremium={!!isPremium} onOpenPremiumInfo={onOpenPremiumInfo} />
      </div>

      {/* ── Divider ── */}
      <div style={{ width: 32, height: 2, borderRadius: 1, background: "var(--cn-border)", margin: "6px 0" }} />

      {onOpenSearch && (
        <button onClick={onOpenSearch} className="cn-nav-btn mb-1" title="Глобальный поиск" aria-label="Глобальный поиск">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        </button>
      )}

      {/* ── Main Navigation Buttons ── */}
      <div className="flex flex-col items-center gap-1 flex-1 w-full px-3">
        {sections.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => onChangeSection(key)}
            className={`cn-nav-btn ${activeSection === key ? "active" : ""}`}
            title={label}
            aria-label={label}
            aria-current={activeSection === key ? "page" : undefined}
          >
            {icon}
          </button>
        ))}
      </div>

      {/* ── Bottom: user panel ── */}
      <div className="flex flex-col items-center gap-2 w-full px-3">
        {/* Mic */}
        {onToggleMic && (
          <button
            onClick={onToggleMic}
            className="w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-200"
            style={{
              background: micActive ? "rgba(239,68,68,0.15)" : "var(--cn-accent-dim)",
              color: micActive ? "#ef4444" : "var(--cn-muted)",
              border: "none",
            }}
            title={micActive ? "Выкл. микрофон" : "Вкл. микрофон"}
          >
            <MicIcon size={22} style={{ color: "inherit", opacity: micActive ? 1 : 0.4 }} />
          </button>
        )}

        {/* Settings gear */}
        {onOpenAi && (
          <button
            onClick={onOpenAi}
            className="w-11 h-11 rounded-xl flex items-center justify-center transition-transform duration-200 hover:scale-105 select-none"
            style={{
              background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
              color: "#ffffff",
              border: "none",
            }}
            title="TZ.AI Ассистент"
            aria-label="Открыть TZ.AI ассистента"
          >
            <span className="text-[9px] font-bold tracking-wide leading-none">TZ.AI</span>
          </button>
        )}

        <button
          onClick={onProfileSettings}
            data-shell-hide="true"
            className="w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-200"
          style={{
            background: "var(--cn-accent-dim)",
            color: "var(--cn-muted)",
            border: "none",
          }}
          title="Настройки"
          aria-label="Настройки профиля"
        >
          <GearIcon size={22} style={{ color: "inherit" }} />
        </button>
      </div>
    </nav>
  );
}

export default memo(NavRail);
