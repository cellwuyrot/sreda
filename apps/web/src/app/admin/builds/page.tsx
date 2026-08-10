"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Spinner from "@/components/ui/Spinner";
import InfoTooltip from "@/components/ui/InfoTooltip";
import { BUILD_TARGET_LABEL, type BuildTarget } from "@/lib/builds";

/**
 * BUILDS: сборка приложений на сервере.
 *
 * Раньше APK и установщик Windows собирались руками на своём ПК и заливались на
 * сервер. Здесь то же самое делает сервер: кнопка ставит задачу в очередь, агент
 * её забирает, и готовые файлы попадают в то же хранилище загрузок — адрес
 * скачивания не меняется.
 *
 * Страница намеренно скучная: список задач, состояние, журнал. Сборка — это
 * место, где важно видеть, что произошло, а не как это оформлено.
 */

interface Job {
  id: string;
  target: string;
  status: string;
  ref: string;
  version: string;
  artifacts: string[];
  error: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  QUEUED: "Ожидает",
  RUNNING: "Идёт сборка",
  SUCCESS: "Готово",
  FAILED: "Ошибка",
  CANCELED: "Отменена",
};

const STATUS_CLASS: Record<string, string> = {
  QUEUED: "bg-neutral-500/15 text-neutral-500 dark:text-neutral-400",
  RUNNING: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  SUCCESS: "bg-green-500/15 text-green-600 dark:text-green-400",
  FAILED: "bg-red-500/15 text-red-500",
  CANCELED: "bg-neutral-500/15 text-neutral-500 dark:text-neutral-400",
};

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function took(job: Job): string {
  if (!job.startedAt) return "";
  const end = job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - new Date(job.startedAt).getTime()) / 1000));
  return seconds < 60 ? `${seconds} с` : `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
}

export default function AdminBuildsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [agent, setAgent] = useState<{ name: string; lastSeenAt: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [log, setLog] = useState("");

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") router.push("/connect");
  }, [session, status, router]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/builds");
      if (!res.ok) throw new Error("Не удалось загрузить список сборок");
      const data = await res.json();
      setJobs(Array.isArray(data?.jobs) ? data.jobs : []);
      setAgent(data?.agent ?? null);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session?.user?.role !== "ADMIN") return;
    void load();
    /* Пока что-то идёт, список обновляется сам: сборка длится минуты, и стоять
       над кнопкой «обновить» человеку незачем. */
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [session, load]);

  const openLog = useCallback(async (id: string) => {
    setOpenId(id);
    setLog("Загрузка…");
    try {
      const res = await fetch(`/api/admin/builds?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      setLog(data?.job?.log || "Журнал пуст — сборка ещё не начиналась.");
    } catch {
      setLog("Не удалось получить журнал");
    }
  }, []);

  useEffect(() => {
    if (!openId) return;
    const job = jobs.find((j) => j.id === openId);
    if (job?.status !== "RUNNING") return;
    const timer = setInterval(() => void openLog(openId), 5000);
    return () => clearInterval(timer);
  }, [openId, jobs, openLog]);

  const start = async (target: BuildTarget) => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/builds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || "Не удалось поставить сборку"); return; }
      setError("");
      await load();
    } catch {
      setError("Ошибка сети");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/builds", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "cancel" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) setError(data?.error || "Не удалось отменить");
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (status === "loading") {
    return <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950"><Spinner /></div>;
  }
  if (session?.user?.role !== "ADMIN") return null;

  const agentOnline = !!agent?.lastSeenAt && Date.now() - new Date(agent.lastSeenAt).getTime() < 2 * 60 * 1000;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="text-sm text-neutral-500 hover:text-neutral-800 dark:text-gray-400 dark:hover:text-white">← Назад</Link>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-white">
            Сборки{" "}
            <InfoTooltip
              side="bottom"
              text="Приложения собираются на сервере из кода репозитория. Готовые файлы попадают в то же хранилище, откуда их скачивают со страницы «О проекте», — адрес скачивания не меняется. Одновременно идёт только одна сборка: она занимает всю машину."
            />
          </h1>
        </div>

        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}

        {/* Без агента очередь просто копится — об этом надо сказать сразу, а не
            оставлять человека наедине с задачей в состоянии «Ожидает». */}
        {!loading && !agent && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
            Агент сборки не заведён: в разделе «Серверы» нужен узел с назначением «Сборка», а на машине — служба
            trioz-builder. Пока его нет, задачи будут стоять в очереди.
          </p>
        )}
        {!loading && agent && !agentOnline && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
            Агент «{agent.name}» не выходил на связь. Проверьте службу: systemctl status trioz-builder.
          </p>
        )}

        <section className="rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 p-4">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">Собрать</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {(Object.keys(BUILD_TARGET_LABEL) as BuildTarget[]).map((target) => (
              <button
                key={target}
                type="button"
                disabled={busy}
                onClick={() => void start(target)}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 dark:bg-cyan-500 dark:hover:bg-cyan-400 dark:text-neutral-950"
              >
                {BUILD_TARGET_LABEL[target]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-neutral-500 dark:text-gray-400">
            Собирается ветка main. Android — 3–7 минут, Windows — 5–15 минут при первой сборке.
          </p>
        </section>

        <section className="rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 p-4">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">Последние сборки</h2>
          {loading ? (
            <p className="mt-2 text-xs text-neutral-400">Загрузка…</p>
          ) : jobs.length === 0 ? (
            <p className="mt-2 text-xs text-neutral-500 dark:text-gray-400">Сборок пока не было.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {jobs.map((job) => (
                <div key={job.id} className="rounded-lg border border-neutral-200 dark:border-white/10 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-neutral-900 dark:text-white">
                      {BUILD_TARGET_LABEL[job.target as BuildTarget] ?? job.target}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CLASS[job.status] ?? ""}`}>
                      {STATUS_LABEL[job.status] ?? job.status}
                    </span>
                    {job.version && (
                      <span className="rounded-full bg-neutral-100 dark:bg-white/10 px-2 py-0.5 text-[10px] text-neutral-600 dark:text-gray-300">
                        {job.version}
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-neutral-400">
                      {when(job.createdAt)}{took(job) && ` · ${took(job)}`}
                    </span>
                  </div>

                  {job.error && <p className="mt-1 text-xs text-red-500">{job.error}</p>}
                  {job.artifacts.length > 0 && (
                    <p className="mt-1 text-xs text-neutral-500 dark:text-gray-400">
                      Файлы:{" "}
                      {job.artifacts.map((name, i) => (
                        <span key={name}>
                          {i > 0 && ", "}
                          <a
                            href={`/desktop/${encodeURIComponent(name)}`}
                            className="text-violet-600 hover:underline dark:text-cyan-400"
                          >
                            {name}
                          </a>
                        </span>
                      ))}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => (openId === job.id ? setOpenId(null) : void openLog(job.id))}
                      className="text-neutral-600 hover:underline dark:text-gray-300"
                    >
                      {openId === job.id ? "Скрыть журнал" : "Журнал"}
                    </button>
                    {(job.status === "QUEUED" || job.status === "RUNNING") && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void cancel(job.id)}
                        className="text-red-500 hover:underline disabled:opacity-50"
                      >
                        Отменить
                      </button>
                    )}
                  </div>

                  {openId === job.id && (
                    <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-neutral-900 px-3 py-2 text-[11px] leading-relaxed text-neutral-200">
                      {log}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
