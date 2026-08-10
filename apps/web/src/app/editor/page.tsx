"use client";

import { useSession } from "next-auth/react";
import Spinner from "@/components/ui/Spinner";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import SystemStatsPanel from "@/components/admin/SystemStatsPanel"; // FIX-ADM1
import { motion } from "framer-motion";
import Link from "next/link";
import BackButton from "@/components/ui/BackButton"; // BACK-STEP

interface Stats {
  users: number;
  services: number;
}

/* ─── Icons (line style, matching the admin page vocabulary) ─── */
function Icon({ path }: { path: React.ReactNode }) {
  return (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      {path}
    </svg>
  );
}

interface NavItem {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
  countKey?: keyof Stats;
}
interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    id: "community",
    label: "Пользователи",
    items: [
      { title: "Пользователи", description: "Управление, баны, роли", href: "/admin/users", icon: <Icon path={<><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M16 5.5a3 3 0 0 1 0 5.7M18 20c0-2.4-.9-4.2-2.3-5.3" /></>} />, countKey: "users" },
      { title: "Премиум", description: "Выдача premium и функции", href: "/admin/premium", icon: <Icon path={<path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 18l-5.8 3.4 1.1-6.5L2.6 9.8l6.5-.9L12 3z" />} /> },
      { title: "Значки", description: "Награды и достижения", href: "/admin/badges", icon: <Icon path={<><circle cx="12" cy="9" r="5" /><path d="M9 13.5 8 21l4-2 4 2-1-7.5" /></>} /> },
      { title: "Обращения", description: "История обращений, обратная связь", href: "/admin/appeals", icon: <Icon path={<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>} /> },
      { title: "Проекты", description: "Заявки личных кабинетов, прогресс работ", href: "/admin/projects", icon: <Icon path={<><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /><path d="m9 13 2 2 4-4" /></>} /> }, // FIX-CABINET
      { title: "Рассылка", description: "Уведомления всем пользователям", href: "/admin/broadcast", icon: <Icon path={<><path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z" /><path d="M16 9a3 3 0 0 1 0 6" /></>} /> },
      /* Тот же раздел, что в админской: настройка личная, и редактор должен сам
         решать, приходят ли ему письма о новых обращениях. */
      { title: "Уведомления", description: "Обратная связь по почте о новых обращениях", href: "/admin/notifications", icon: <Icon path={<><path d="M18 16v-5a6 6 0 1 0-12 0v5l-1.5 2h15L18 16z" /><path d="M10 21h4" /></>} /> },
    ],
  },
  {
    id: "system",
    label: "Сервисы и система",
    items: [
      { title: "ИИ-ассистент", description: "API-ключ, модель, промт", href: "/admin/ai", icon: <Icon path={<><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /><circle cx="12" cy="12" r="2.5" /></>} /> },
      { title: "Логи редактора", description: "Кто и что редактировал", href: "/admin/logs", icon: <Icon path={<><path d="M4 5h16M4 12h16M4 19h10" /></>} /> },
    ],
  },
];

type CategoryId = "community" | "system";

function Row({ item, count }: { item: NavItem; count?: number }) {
  return (
    <Link
      href={item.href}
      className="group flex items-center gap-4 rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 px-4 py-3.5 transition-all duration-200 hover:border-violet-400/60 dark:hover:border-cyan-500/50 hover:shadow-sm"
    >
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:bg-cyan-500/10 dark:text-cyan-400">
        {item.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-neutral-900 dark:text-white">{item.title}</p>
        <p className="truncate text-xs text-neutral-500 dark:text-gray-400">{item.description}</p>
      </div>
      {typeof count === "number" && (
        <span className="rounded-full bg-neutral-100 dark:bg-white/10 px-2.5 py-0.5 text-xs font-medium text-neutral-600 dark:text-gray-300">
          {count}
        </span>
      )}
      <svg className="h-4 w-4 flex-shrink-0 text-neutral-300 transition-colors group-hover:text-violet-500 dark:text-gray-600 dark:group-hover:text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

export default function EditorPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const allowed = role === "EDITOR" || role === "ADMIN";
  const [stats, setStats] = useState<Stats>({ users: 0, services: 0 });
  const [activeCat, setActiveCat] = useState<CategoryId>("community");
  const [mobileContentOpen, setMobileContentOpen] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/auth/signin");
    else if (status === "authenticated" && !allowed) router.replace("/connect");
  }, [status, allowed, router]);

  useEffect(() => {
    if (!allowed) return;
    fetch("/api/editor/overview", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.stats) setStats({ users: data.stats.users ?? 0, services: data.stats.services ?? 0 });
      })
      .catch(() => {});
  }, [allowed]);

  if (status === "loading" || (status === "authenticated" && !allowed)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <Spinner />
      </div>
    );
  }
  if (!allowed) return null;

  const NAV: { id: CategoryId; label: string; icon: React.ReactNode }[] = [
    { id: "community", label: "Пользователи", icon: <Icon path={<><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /></>} /> },
    { id: "system", label: "Сервисы и система", icon: <Icon path={<><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.4l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2.4-1.4L13.8 2h-3.6l-.4 2.3A7 7 0 0 0 7.4 5.7l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .5 0 .9.1 1.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2.4 1.4l.4 2.3h3.6l.4-2.3a7 7 0 0 0 2.4-1.4l2.3 1 2-3.4-2-1.5c.1-.5.1-.9.1-1.4z" /></>} /> },
  ];

  const activeGroup = GROUPS.find((g) => g.id === activeCat);
  const activeLabel = NAV.find((n) => n.id === activeCat)?.label ?? "Пользователи";

  const selectCat = (id: CategoryId) => {
    setActiveCat(id);
    setMobileContentOpen(true);
  };

  const renderContent = () => {
    if (!activeGroup) return null;
    return (
      <div className="space-y-6">
        {activeCat === "system" && <SystemStatsPanel />}{/* FIX-ADM1 */}
        <div className="space-y-2.5">
          {activeGroup.items.map((item) => (
            <Row key={item.href} item={item} count={item.countKey ? stats[item.countKey] : undefined} />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 px-4 pb-12 pt-8 max-md:px-3">
      <div className="mx-auto max-w-5xl md:flex md:gap-6">
        {/* Sidebar */}
        <aside className={`md:w-64 md:flex-shrink-0 ${mobileContentOpen ? "hidden md:block" : "block"}`}>
          <div className="md:sticky md:top-8">
            <div className="mb-4 flex items-center gap-3 px-1">
              <BackButton fallback="/connect" className="text-neutral-500 transition-opacity hover:opacity-70 dark:text-gray-400" aria-label="Назад в TZ Connect">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </BackButton>
              <div>
                <h1 className="text-xl font-bold text-neutral-900 dark:text-white">Редакторская</h1>
                <p className="text-xs text-neutral-500 dark:text-gray-400">Управление экосистемой TrioZ</p>
              </div>
            </div>

            <nav className="space-y-0.5">
              {NAV.map((item) => (
                <button
                  key={item.id}
                  onClick={() => selectCat(item.id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                    activeCat === item.id
                      ? "bg-violet-500/10 text-violet-700 dark:bg-cyan-500/10 dark:text-cyan-300"
                      : "text-neutral-600 hover:bg-neutral-100 dark:text-gray-300 dark:hover:bg-white/5"
                  }`}
                >
                  <span className={activeCat === item.id ? "text-violet-600 dark:text-cyan-400" : "text-neutral-400 dark:text-gray-500"}>
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
        </aside>

        {/* Content */}
        <main className={`min-w-0 flex-1 ${mobileContentOpen ? "block" : "hidden md:block"}`}>
          <button
            onClick={() => setMobileContentOpen(false)}
            className="mb-4 flex items-center gap-2 text-sm font-medium text-neutral-600 dark:text-gray-300 md:hidden"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {activeLabel}
          </button>
          <motion.div
            key={activeCat}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            {renderContent()}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
