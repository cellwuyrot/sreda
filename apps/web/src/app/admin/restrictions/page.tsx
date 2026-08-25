"use client";

/* MAIL-WHITELIST: «Настройки ограничений» — оглавление раздела.

   Сама таблица доменов живёт в подразделе, а не на этом экране: ограничений
   будет больше одного (чёрные списки, лимиты, ограничения по странам), и каждое
   из них — это своя таблица с поиском и постраничным списком. Сложи их на
   одну страницу — и получится полотно на несколько экранов прокрутки, в котором
   нужный список ищешь глазами. Здесь только входы. */

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useAdminBackHref, useAdminBackLabel } from "@/components/admin/useAdminBackHref";

interface Section {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    title: "Белые списки",
    description: "Регистрация по почте: домены, с которых можно завести аккаунт",
    href: "/admin/restrictions/whitelist",
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16v12H4z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="m5 7 7 5 7-5" />
      </svg>
    ),
  },
];

export default function AdminRestrictionsPage() {
  const backHref = useAdminBackHref();
  const backLabel = useAdminBackLabel();
  const { data: session, status } = useSession();

  if (status === "loading") return <div className="p-8 text-neutral-500 dark:text-white/60">Загрузка…</div>;
  if (session?.user?.role !== "ADMIN") return null;

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 pb-12 pt-8">
      <div className="mb-6">
        <Link href={backHref} className="text-sm text-neutral-500 hover:text-neutral-900 dark:text-white/60 dark:hover:text-white">
          {backLabel}
        </Link>
      </div>

      <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-white">Настройки ограничений</h1>
      <p className="mb-6 text-sm text-neutral-500 dark:text-gray-400">Кому и что разрешено на входе в проект</p>

      <div className="space-y-2.5">
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="group flex items-center gap-4 rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 px-4 py-3.5 transition-all duration-200 hover:border-violet-400/60 dark:hover:border-cyan-500/50 hover:shadow-sm"
          >
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:bg-cyan-500/10 dark:text-cyan-400">
              {section.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-neutral-900 dark:text-white">{section.title}</p>
              <p className="truncate text-xs text-neutral-500 dark:text-gray-400">{section.description}</p>
            </div>
            <svg className="h-4 w-4 flex-shrink-0 text-neutral-300 transition-colors group-hover:text-violet-500 dark:text-gray-600 dark:group-hover:text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        ))}
      </div>
    </div>
  );
}
