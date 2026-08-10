"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

const TABS = [
  {
    href: "/",
    label: "Главная",
    icon: (
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    href: "/connect",
    label: "Connect",
    icon: (
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    href: "/library",
    label: "Библиотека",
    icon: (
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    href: "/projects",
    label: "Проекты",
    icon: (
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" />
        <polyline points="2 12 12 17 22 12" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Профиль",
    icon: (
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

export default function BottomNav() {
  const pathname = usePathname();

  const isHidden = pathname === "/" || pathname === "/about" || pathname?.startsWith("/auth") || pathname?.startsWith("/connect") || pathname?.startsWith("/workspace");
  if (isHidden) return null;

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around
        bg-white/95 dark:bg-neutral-950/95 backdrop-blur-lg
        border-t border-neutral-200 dark:border-white/5"
      style={{
        height: `calc(56px + env(safe-area-inset-bottom, 0px))`,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {TABS.map((tab) => {
        const isActive =
          tab.href === "/"
            ? pathname === "/"
            : pathname?.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full
              transition-colors duration-200 active:scale-95
              ${isActive
                ? "text-accent"
                : "text-neutral-400 dark:text-neutral-500"
              }`}
          >
            {tab.icon}
            <span className="text-[10px] font-medium leading-none">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
