"use client";

import { useSession } from "next-auth/react";
import Spinner from "@/components/ui/Spinner";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";

import { useAdminBackHref, useAdminBackLabel } from "@/components/admin/useAdminBackHref"; // FIX-EDR2
interface AuditLog {
  id: string;
  userId: string;
  username: string;
  action: string;
  target: string;
  targetId: string | null;
  details: string | null;
  createdAt: string;
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  create: { label: "Создание", color: "text-green-400" },
  update: { label: "Изменение", color: "text-blue-400" },
  delete: { label: "Удаление", color: "text-red-400" },
  ban: { label: "Бан", color: "text-orange-400" },
  unban: { label: "Разбан", color: "text-emerald-400" },
};

const TARGET_LABELS: Record<string, string> = {
  User: "Пользователь",
  WindowConfig: "Окно главной",
  SiteContent: "Контент сайта",
  AISettings: "Настройки ИИ",
  Badge: "Бейдж",
  Group: "Группа",
};

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин. назад`;
  if (diffHour < 24) return `${diffHour} ч. назад`;
  if (diffDay < 7) return `${diffDay} дн. назад`;

  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: diffDay > 365 ? "numeric" : undefined,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminLogsPage() {
  // FIX-EDR2: редактору «Назад» ведёт в «Редакторскую», админу — в админку
  const backHref = useAdminBackHref();
  const backLabel = useAdminBackLabel();
  const { data: session, status } = useSession();
  const router = useRouter();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState("");

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN" && session?.user?.role !== "EDITOR") {
      router.push("/");
    }
  }, [session, status, router]);

  useEffect(() => {
    if (session?.user?.role !== "ADMIN" && session?.user?.role !== "EDITOR") return;

    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "50" });
    if (filterAction) params.set("action", filterAction);

    fetch(`/api/admin/logs?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setLogs(data.logs || []);
        setTotal(data.total || 0);
      })
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, [session, page, filterAction]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-dark-900">
        <Spinner />
      </div>
    );
  }

  if (session?.user?.role !== "ADMIN" && session?.user?.role !== "EDITOR") return null;

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-dark-900 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6"
        >
          <Link
            href={backHref}
            className="text-sm text-gray-400 hover:text-white transition-colors mb-2 inline-block"
          >
            {backLabel}
          </Link>
          <h1 className="text-3xl font-bold text-neutral-900 dark:text-white mb-2">
            Логи редактора сайта
          </h1>
          <p className="text-neutral-500 dark:text-gray-400">
            Журнал действий администраторов и редакторов
          </p>
        </motion.div>

        <div className="glass-card p-4 mb-6">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => { setFilterAction(""); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                !filterAction
                  ? "bg-cyan-400/20 text-cyan-400 border border-cyan-400/30"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}
            >
              Все
            </button>
            {Object.entries(ACTION_LABELS).map(([key, { label, color }]) => (
              <button
                key={key}
                onClick={() => { setFilterAction(key); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  filterAction === key
                    ? `bg-white/10 ${color} border border-white/20`
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="glass-card overflow-hidden">
          {loading ? (
            <div className="p-8 text-center">
              <Spinner className="mx-auto" />
            </div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              Логи отсутствуют
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {logs.map((log, i) => {
                const actionInfo = ACTION_LABELS[log.action] || { label: log.action, color: "text-gray-400" };
                const targetLabel = TARGET_LABELS[log.target] || log.target;

                return (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.02 }}
                    className="p-4 hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-sm font-medium ${actionInfo.color}`}>
                            {actionInfo.label}
                          </span>
                          <span className="text-xs text-gray-500">•</span>
                          <span className="text-sm text-neutral-600 dark:text-gray-300">
                            {targetLabel}
                          </span>
                        </div>
                        {log.details && (
                          <p className="text-sm text-neutral-500 dark:text-gray-400 truncate">
                            {log.details}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-medium text-neutral-700 dark:text-gray-200">
                          @{log.username}
                        </div>
                        <div className="text-xs text-neutral-500 dark:text-gray-500">
                          {formatTime(log.createdAt)}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {totalPages > 1 && (
            <div className="p-4 border-t border-white/5 flex items-center justify-between">
              <span className="text-sm text-gray-400">
                Страница {page} из {totalPages} ({total} записей)
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 rounded-lg text-sm bg-white/5 text-gray-300 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  ← Назад
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 rounded-lg text-sm bg-white/5 text-gray-300 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Далее →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
