"use client";

// FIX-ADM1: метрики раздела «Сервисы и система» (админ-панель и редакторская)
import { useEffect, useState } from "react";

interface SystemStats {
  onlineNow: number;
  messages24h: number;
  activeProjects: number | null;
  systemErrors: number | null;
  aiRequests: number | null;
  storageUsage: string | null;
  serverLoad: string | null;
}

const CARDS: { key: keyof SystemStats; label: string; stub?: boolean }[] = [
  { key: "onlineNow", label: "Онлайн сейчас всего" },
  { key: "messages24h", label: "Сообщений за сутки" },
  { key: "activeProjects", label: "Активных проектов", stub: true },
  { key: "systemErrors", label: "Ошибок системы", stub: true },
  { key: "aiRequests", label: "AI-запросов", stub: true },
  { key: "storageUsage", label: "Использование хранилища", stub: true },
  { key: "serverLoad", label: "Загруженность сервера", stub: true },
];

export default function SystemStatsPanel() {
  const [stats, setStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/admin/system-stats", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!cancelled && data) setStats(data);
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const display = (card: { key: keyof SystemStats; stub?: boolean }): string => {
    if (card.stub) return "—";
    if (!stats) return "…";
    const value = stats[card.key];
    return value === null || value === undefined ? "0" : String(value);
  };

  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 p-5">
      <h2 className="mb-1 text-base font-semibold text-neutral-900 dark:text-white">Состояние системы</h2>
      <p className="mb-4 text-xs text-neutral-500 dark:text-gray-400">Метрики обновляются автоматически каждые 30 секунд</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {CARDS.map((card) => (
          <div key={card.key} className="relative rounded-2xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 p-4">
            {card.stub && (
              <span className="absolute right-2 top-2 rounded-full bg-neutral-200/70 dark:bg-white/10 px-2 py-0.5 text-[10px] font-medium text-neutral-500 dark:text-gray-400">
                скоро
              </span>
            )}
            <p className="text-2xl font-bold text-neutral-900 dark:text-white">{display(card)}</p>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-gray-400">{card.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
