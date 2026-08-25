"use client";

import { useSession } from "next-auth/react";
import Spinner from "@/components/ui/Spinner";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import SystemStatsPanel from "@/components/admin/SystemStatsPanel"; // FIX-ADM1
// MAIL-WHITELIST: белые списки того же раздела: кто вообще может зарегистрироваться.
import EmailWhitelistPanel from "@/components/admin/EmailWhitelistPanel";
import { motion } from "framer-motion";
import Link from "next/link";
import BackButton from "@/components/ui/BackButton"; // BACK-STEP

interface Stats {
  users: number;
  channels: number;
  articles: number;
  services: number;
  /** Сколько услуг опубликовано (active) — остальные скрыты с сайта. */
  activeServices: number;
  groups: number;
  serverNodes: number;
  games: number;
}

/* ─── Icons (line style, matching the settings page vocabulary) ─── */
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
    id: "content",
    label: "Контент сайта",
    items: [
      { title: "Правовая информация", description: "Пользовательское соглашение на /about", href: "/admin/legal", icon: <Icon path={<><path d="M6 3h9l3 3v15H6z" /><path d="M9 9h6M9 13h6M9 17h4" /></>} /> },
      { title: "О проекте", description: "Тексты и блоки страницы /about", href: "/admin/about", icon: <Icon path={<><circle cx="12" cy="12" r="9" /><path d="M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18M3 12h18" /></>} /> },
      { title: "Окна главной", description: "Фоны, цвета и контент 4 окон", href: "/admin/windows", icon: <Icon path={<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>} /> },
      { title: "Контент", description: "Статьи и категории", href: "/admin/content", icon: <Icon path={<><path d="M4 4h16v16H4z" /><path d="M8 8h8M8 12h8M8 16h5" /></>} />, countKey: "articles" },
      { title: "Экосистема", description: "Элементы экосистемы", href: "/admin/ecosystem", icon: <Icon path={<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" /></>} /> },
      { title: "Приветствие", description: "Текст согласия после регистрации", href: "/admin/welcome", icon: <Icon path={<><path d="M4 4h16v12H5.2L4 18z" /><path d="M8 9h8M8 12h5" /></>} /> },
    ],
  },
  {
    id: "community",
    label: "Пользователи и сообщество",
    items: [
      { title: "Пользователи", description: "Управление, баны, роли", href: "/admin/users", icon: <Icon path={<><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M16 5.5a3 3 0 0 1 0 5.7M18 20c0-2.4-.9-4.2-2.3-5.3" /></>} />, countKey: "users" },
      { title: "Подписки пользователей", description: "Premium и подписка «Ускоренный интернет»", href: "/admin/premium", icon: <Icon path={<path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 18l-5.8 3.4 1.1-6.5L2.6 9.8l6.5-.9L12 3z" />} /> },
      { title: "Значки", description: "Награды и достижения", href: "/admin/badges", icon: <Icon path={<><circle cx="12" cy="9" r="5" /><path d="M9 13.5 8 21l4-2 4 2-1-7.5" /></>} /> },
      { title: "Обращения", description: "История обращений, обратная связь", href: "/admin/appeals", icon: <Icon path={<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>} /> },
      { title: "Проекты", description: "Заявки личных кабинетов, прогресс работ", href: "/admin/projects", icon: <Icon path={<><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /><path d="m9 13 2 2 4-4" /></>} /> }, // FIX-CABINET
      { title: "Рассылка", description: "Уведомления всем пользователям", href: "/admin/broadcast", icon: <Icon path={<><path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z" /><path d="M16 9a3 3 0 0 1 0 6" /></>} /> },
      /* Обратная связь по почте о новых обращениях: колокольчик работает только
         пока человек в приложении, а заявка приходит и ночью. */
      { title: "Уведомления", description: "Обратная связь по почте о новых обращениях", href: "/admin/notifications", icon: <Icon path={<><path d="M18 16v-5a6 6 0 1 0-12 0v5l-1.5 2h15L18 16z" /><path d="M10 21h4" /></>} /> },
    ],
  },
  {
    id: "system",
    label: "Сервисы и система",
    items: [
      { title: "ИИ-ассистент", description: "API-ключ, модель, промт", href: "/admin/ai", icon: <Icon path={<><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /><circle cx="12" cy="12" r="2.5" /></>} /> },
      /* BUSINESS-SUB: раздел перестал быть только премиумным: теперь в нём две
         независимые группы реквизитов — подписка Premium и счета бизнеса. */
      { title: "Платежи", description: "Реквизиты Premium и счетов бизнеса", href: "/admin/payments", icon: <Icon path={<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20M6 15h4" /></>} /> },
      { title: "Логи редактора", description: "Кто и что редактировал", href: "/admin/logs", icon: <Icon path={<><path d="M4 5h16M4 12h16M4 19h10" /></>} /> },
      /* FIX-ADMCOUNT: страница управления услугами существовала, но входа в неё
         из панели не было — счётчик «Услуг» в обзоре выглядел взявшимся из
         ниоткуда, потому что посмотреть эти записи было негде. */
      { title: "Услуги", description: "Записи раздела услуг: создание, публикация, порядок", href: "/admin/services", icon: <Icon path={<><rect x="3" y="4" width="18" height="6" rx="1" /><rect x="3" y="14" width="18" height="6" rx="1" /></>} />, countKey: "services" },
      /* VPN-PANEL: управление сервисом VPN. */
      { title: "Надёжное соединение", description: "Лимит трафика, серверы и загруженность, общий выключатель", href: "/admin/vpn", icon: <Icon path={<><path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z" /><path d="M9.5 12l1.8 1.8 3.2-3.6" /></>} /> },
      /* GAMES-CATALOG: каталог раздела /games — свои и партнёрские игры. */
      { title: "Игры", description: "Свои и партнёрские игры: интеграция по API, активация", href: "/admin/games", icon: <Icon path={<><rect x="2" y="7" width="20" height="10" rx="4" /><path d="M7 12h3M8.5 10.5v3" /><circle cx="15.5" cy="11" r="1" /><circle cx="17.5" cy="13.5" r="1" /></>} />, countKey: "games" },
      /* BUILDS: сборка клиентских приложений на сервере. Раньше APK и
         установщик собирались руками на своём ПК и заливались файлами. */
      { title: "Сборки", description: "APK и установщик Windows: сборка на сервере, журнал, готовые файлы", href: "/admin/builds", icon: <Icon path={<><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></>} /> },
      /* SERVER-MESH: реестр главного и дочерних серверов. */
      { title: "Серверы", description: "Главный сервер и дочерние узлы: связка, токены, состояние", href: "/admin/servers", icon: <Icon path={<><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 8h.01M7 17h.01" /></>} />, countKey: "serverNodes" },
    ],
  },
];

type CategoryId = "overview" | "content" | "community" | "system";

const QUICK_ACTIONS = [
  { title: "Редактировать раздел «О проекте»", href: "/admin/about" },
  { title: "Настроить окна главной", href: "/admin/windows" },
  { title: "Создать статью", href: "/admin/content" },
  { title: "Управление пользователями", href: "/admin/users" },
  { title: "Управление премиумом", href: "/admin/premium" },
  { title: "Платежи", href: "/admin/payments" },
  { title: "Рассылка уведомлений", href: "/admin/broadcast" },
];

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

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [stats, setStats] = useState<Stats>({
    users: 0, channels: 0, articles: 0, services: 0, activeServices: 0, groups: 0, serverNodes: 0, games: 0,
  });
  const [activeCat, setActiveCat] = useState<CategoryId>("overview");
  const [mobileContentOpen, setMobileContentOpen] = useState(false);

  useEffect(() => {
    // FIX-NAV: раньше редирект вёл на главную сайта ("/"). Из-за этого выход из
    // админ-панели мог заканчиваться на главной: при клике «Назад» сессия
    // параллельно перепроверяется, и если роль на мгновение не видна, guard
    // перетирал переход на /connect переходом на "/". Теперь в любом случае
    // возвращаем пользователя в TZ Connect (как в editor/partner).
    if (status === "authenticated" && session?.user?.role !== "ADMIN") router.push("/connect");
  }, [session, status, router]);

  useEffect(() => {
    if (session?.user?.role === "ADMIN") {
      /* FIX-ADMCOUNT: один админский эндпоинт с честными счётчиками вместо
         четырёх пользовательских списков. GET /api/channels без groupId по
         своей природе отдаёт пустой массив — из-за этого «Каналов» всегда
         показывало 0, хотя каналов в базе много. */
      fetch("/api/admin/system-stats")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const counts = data?.counts;
          if (!counts) return;
          setStats({
            users: Number(counts.users) || 0,
            channels: Number(counts.channels) || 0,
            articles: Number(counts.articles) || 0,
            services: Number(counts.services) || 0,
            activeServices: Number(counts.activeServices) || 0,
            groups: Number(counts.groups) || 0,
            serverNodes: Number(counts.serverNodes) || 0,
            games: Number(counts.games) || 0,
          });
        })
        .catch(() => {});
    }
  }, [session]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <Spinner />
      </div>
    );
  }
  if (session?.user?.role !== "ADMIN") return null;

  const NAV: { id: CategoryId; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Обзор", icon: <Icon path={<><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>} /> },
    { id: "content", label: "Контент сайта", icon: <Icon path={<><path d="M4 4h16v16H4z" /><path d="M8 8h8M8 12h8M8 16h5" /></>} /> },
    { id: "community", label: "Пользователи", icon: <Icon path={<><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /></>} /> },
    { id: "system", label: "Сервисы и система", icon: <Icon path={<><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.4l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2.4-1.4L13.8 2h-3.6l-.4 2.3A7 7 0 0 0 7.4 5.7l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .5 0 .9.1 1.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2.4 1.4l.4 2.3h3.6l.4-2.3a7 7 0 0 0 2.4-1.4l2.3 1 2-3.4-2-1.5c.1-.5.1-.9.1-1.4z" /></>} /> },
  ];

  const statCards: { label: string; value: number; hint?: string }[] = [
    { label: "Пользователей", value: stats.users },
    { label: "Сообществ", value: stats.groups },
    { label: "Каналов", value: stats.channels },
    { label: "Статей", value: stats.articles },
    /* Услуги — это записи раздела «Услуги» (их создаёт админ, а 11 штук
       заводит prisma/seed.ts при первичном наполнении базы). Показываем
       сколько из них опубликовано, чтобы число не выглядело взявшимся
       из ниоткуда. */
    { label: "Услуг опубликовано", value: stats.activeServices, hint: `всего ${stats.services}` },
  ];

  const activeGroup = GROUPS.find((g) => g.id === activeCat);
  const activeLabel = NAV.find((n) => n.id === activeCat)?.label ?? "Обзор";

  const selectCat = (id: CategoryId) => {
    setActiveCat(id);
    setMobileContentOpen(true);
  };

  const renderContent = () => {
    if (activeCat === "overview") {
      return (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {statCards.map((s) => (
              <div key={s.label} className="rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 p-4">
                <p className="text-2xl font-bold text-neutral-900 dark:text-white">{s.value}</p>
                <p className="mt-0.5 text-xs text-neutral-500 dark:text-gray-400">{s.label}</p>
                {s.hint && <p className="mt-0.5 text-[10px] text-neutral-400 dark:text-gray-500">{s.hint}</p>}
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 p-5">
            <h2 className="mb-1 text-base font-semibold text-neutral-900 dark:text-white">Быстрые действия</h2>
            <p className="mb-4 text-xs text-neutral-500 dark:text-gray-400">Частые задачи администратора</p>
            <div className="space-y-2">
              {QUICK_ACTIONS.map((a) => (
                <Link
                  key={a.href + a.title}
                  href={a.href}
                  className="group flex items-center justify-between rounded-xl px-3 py-2.5 text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-gray-300 dark:hover:bg-white/5"
                >
                  <span>{a.title}</span>
                  <svg className="h-4 w-4 text-neutral-300 transition-colors group-hover:text-violet-500 dark:text-gray-600 dark:group-hover:text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (!activeGroup) return null;
    return (
      <div className="space-y-6">
        {activeCat === "system" && <SystemStatsPanel />}{/* FIX-ADM1 */}
        {activeCat === "system" && <EmailWhitelistPanel />}{/* MAIL-WHITELIST */}
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
                <h1 className="text-xl font-bold text-neutral-900 dark:text-white">Админ-панель</h1>
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
