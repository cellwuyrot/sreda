"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import Spinner from "@/components/ui/Spinner";
import { stageStatusLabel, type OrderStage } from "@/lib/orderStages";
import {
  FileChips,
  ProgressBar,
  ProjectChatLink,
  StatusChip,
  StepList,
  doneOf,
  filesOf,
  progressOf,
  stagesOf,
  type ProjectItem,
} from "@/components/cabinet/ProjectWidgets";
// BUSINESS-CABINET: та же деловая часть, что и в кабинете, но в режиме редактирования.
import ProjectBusinessPanel from "@/components/cabinet/ProjectBusinessPanel";

// FIX-CABINET: обработка заявок личных кабинетов (доступно ADMIN и EDITOR).
// Проект, созданный клиентом в /partner, появляется здесь как новая заявка.
// Прогресс заполняется по этапам УСЛУГИ проекта (см. lib/orderStages.ts);
// выполненный этап откатить нельзя — процент только растёт.

const FILTERS: ReadonlyArray<readonly [string, string]> = [
  ["", "Все"],
  ["NEW", "Новые"],
  ["IN_PROGRESS", "В работе"],
  ["LAUNCHED", "Запущенные"],
];

/* ROLE-STRUCT: по 10 записей на страницу. Список заявок рос бесконечной
   прокруткой, и найти в нём конкретный проект было нечем: поиска не было. */
const PER_PAGE = 10;

export default function AdminProjectsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const sessionUser = session?.user as { id?: string; role?: string } | undefined;
  const role = sessionUser?.role;
  const allowed = role === "ADMIN" || role === "EDITOR";

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [savingStep, setSavingStep] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState(""); // ROLE-STRUCT: поиск проекта
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/auth/signin");
    else if (status === "authenticated" && !allowed) router.replace("/connect"); // FIX-NAV: возврат в connect, не на главную
  }, [status, allowed, router]);

  const fetchProjects = useCallback(() => {
    setLoading(true);
    fetch("/api/projects?scope=staff", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setProjects(Array.isArray(d.projects) ? d.projects : []))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (status === "authenticated" && allowed) fetchProjects();
  }, [status, allowed, fetchProjects]);

  const completeStep = async (project: ProjectItem, stage: OrderStage) => {
    if (savingStep) return;
    if (!window.confirm(`Отметить этап «${stage.title}» выполненным?\nОткатить выполненный этап нельзя — процент только растёт.`)) return;
    setSavingStep(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps: [stage.id] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || "Не удалось обновить прогресс"); return; }
      if (data?.project) setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, ...data.project } : p)));
    } catch {
      setError("Нет соединения с сервером");
    } finally {
      setSavingStep(false);
    }
  };

  /* ROLE-STRUCT: безвозвратное удаление заявки. Подтверждение обязательно:
     вместе с проектом каскадом уйдут переписка, счета, документы и история. */
  const deleteProject = async (project: ProjectItem) => {
    if (deletingId) return;
    if (!window.confirm(`Удалить проект «${project.name}» безвозвратно?\nВместе с ним будут удалены переписка, счета, документы и история этапов.`)) return;
    setDeletingId(project.id);
    setError("");
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || "Не удалось удалить проект"); return; }
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      if (openId === project.id) setOpenId(null);
    } catch {
      setError("Нет соединения с сервером");
    } finally {
      setDeletingId(null);
    }
  };

  if (status === "loading" || (status === "authenticated" && !allowed)) {
    return <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950"><Spinner /></div>;
  }
  if (!allowed) return null;

  const needle = query.trim().toLowerCase();
  const visible = projects.filter((p) => {
    /* Поиск по названию, клиенту, услуге и домену: сотрудник ищет заявку
       по тому, что помнит, а не по внутреннему идентификатору. */
    if (needle) {
      const haystack = [p.name, p.domain, p.service?.title, p.owner?.name, p.owner?.username]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (!filter) return true;
    const progress = progressOf(p);
    if (filter === "NEW") return progress === 0 && p.status !== "LAUNCHED";
    if (filter === "IN_PROGRESS") return progress > 0 && progress < 100 && p.status !== "LAUNCHED";
    return p.status === "LAUNCHED" || progress >= 100;
  });

  const pageCount = Math.max(1, Math.ceil(visible.length / PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = visible.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  return (
    <div className="min-h-screen bg-neutral-50 px-4 pb-12 pt-8 dark:bg-neutral-950 max-md:px-3">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-center gap-3">
          <button onClick={() => router.back()} className="text-neutral-500 transition-opacity hover:opacity-70 dark:text-gray-400" aria-label="Назад">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div>
            <h1 className="text-xl font-bold text-neutral-900 dark:text-white">Проекты</h1>
            <p className="text-xs text-neutral-500 dark:text-gray-400">Заявки личных кабинетов и прогресс работ</p>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={filter === value
                ? "rounded-full bg-violet-600 px-3 py-1.5 text-xs font-medium text-white dark:bg-cyan-500 dark:text-neutral-950"
                : "rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-50 dark:border-white/10 dark:bg-neutral-900 dark:text-gray-300 dark:hover:bg-white/5"}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ROLE-STRUCT: поиск проекта и кнопка напротив него. */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder="Поиск проекта: название, клиент, услуга, домен"
            className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-violet-500 dark:border-white/10 dark:bg-neutral-900 dark:text-white dark:focus:border-cyan-500"
          />
          <button
            onClick={() => { setPage(1); fetchProjects(); }}
            className="flex-shrink-0 rounded-xl bg-violet-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 dark:bg-cyan-500 dark:text-neutral-950 dark:hover:bg-cyan-400"
          >
            Обновить
          </button>
          {query && (
            <button
              onClick={() => { setQuery(""); setPage(1); }}
              className="flex-shrink-0 rounded-xl border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
            >
              Сбросить
            </button>
          )}
        </div>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-white/10 dark:bg-neutral-900">
            <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-4 dark:border-white/10">
              <div><h2 className="font-semibold text-neutral-900 dark:text-white">Заявки на проекты</h2><p className="text-xs text-neutral-500 dark:text-gray-400">Создаются клиентами в личном кабинете</p></div>
              <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] text-neutral-500 dark:bg-white/10 dark:text-gray-400">{visible.length}</span>
            </div>

            {loading ? (
              <div className="grid min-h-72 place-items-center px-6 py-12"><Spinner /></div>
            ) : pageItems.length === 0 ? (
              <div className="grid min-h-72 place-items-center px-6 py-12 text-center">
                <p className="text-sm text-neutral-400">Заявок пока нет</p>
              </div>
            ) : (
              <div className="divide-y divide-neutral-200 dark:divide-white/10">
                {pageItems.map((p) => {
                  const stages = stagesOf(p);
                  const done = doneOf(p, stages);
                  const progress = progressOf(p, stages);
                  const isOpen = openId === p.id;
                  return (
                    <div key={p.id}>
                      <button onClick={() => setOpenId(isOpen ? null : p.id)} className="w-full px-5 py-4 text-left transition hover:bg-neutral-50 dark:hover:bg-white/5">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <p className="truncate font-medium text-neutral-900 dark:text-white">{p.name}</p>
                            <StatusChip status={p.status} progress={progress} />
                          </div>
                          <span className="flex-shrink-0 text-xs text-neutral-400">
                            {p.owner ? `${p.owner.name}${p.owner.username ? ` · @${p.owner.username}` : ""}` : ""} · {new Date(p.createdAt).toLocaleDateString("ru-RU")}
                          </span>
                        </div>
                        <ProgressBar value={progress} label={stageStatusLabel(progress, p.status, stages)} />
                      </button>
                      {isOpen && (
                        <div className="space-y-4 border-t border-neutral-200 bg-neutral-50/50 px-5 py-4 dark:border-white/10 dark:bg-white/[.02]">
                          <div>
                            <p className="mb-1 text-xs font-medium text-neutral-500 dark:text-gray-400">Назначение</p>
                            <p className="whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-200">{p.purpose}</p>
                          </div>
                          <div>
                            <p className="mb-1 text-xs font-medium text-neutral-500 dark:text-gray-400">Услуга</p>
                            <p className="text-sm text-neutral-700 dark:text-neutral-200">{p.service?.title || "Не указана"}</p>
                          </div>
                          {p.domain && (
                            <div>
                              <p className="mb-1 text-xs font-medium text-neutral-500 dark:text-gray-400">Домен</p>
                              <p className="text-sm text-neutral-700 dark:text-neutral-200">{p.domain}</p>
                            </div>
                          )}
                          <div>
                            <p className="mb-1.5 text-xs font-medium text-neutral-500 dark:text-gray-400">Материалы клиента</p>
                            <FileChips files={filesOf(p)} />
                          </div>
                          <div>
                            <p className="mb-1.5 text-xs font-medium text-neutral-500 dark:text-gray-400">Этапы услуги — выполненный откатить нельзя</p>
                            <StepList stages={stages} done={done} onComplete={(stage) => void completeStep(p, stage)} disabled={savingStep} />
                            {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
                          </div>
                          <ProjectChatLink projectId={p.id} />
                          <ProjectBusinessPanel projectId={p.id} isStaff />
                          {/* ROLE-STRUCT: безвозвратное удаление запроса. */}
                          <div className="flex justify-end">
                            <button
                              onClick={() => void deleteProject(p)}
                              disabled={deletingId === p.id}
                              className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-500 transition hover:bg-red-500/10 disabled:opacity-50"
                            >
                              {deletingId === p.id ? "Удаление…" : "Удалить безвозвратно"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ROLE-STRUCT: постранично, по 10 записей. */}
            {pageCount > 1 && (
              <div className="flex items-center justify-between gap-3 border-t border-neutral-200 px-5 py-3 dark:border-white/10">
                <button
                  onClick={() => setPage((v) => Math.max(1, v - 1))}
                  disabled={currentPage <= 1}
                  className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-40 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
                >
                  Назад
                </button>
                <span className="text-xs text-neutral-500 dark:text-gray-400">Страница {currentPage} из {pageCount} · всего {visible.length}</span>
                <button
                  onClick={() => setPage((v) => Math.min(pageCount, v + 1))}
                  disabled={currentPage >= pageCount}
                  className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-40 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
                >
                  Вперёд
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
