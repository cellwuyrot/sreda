"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChatIcon } from "@/components/ui/ConnectIcons";
import {
  normalizeDoneStages,
  stageProgress,
  stagesForService,
  type OrderStage,
} from "@/lib/orderStages";

// FIX-CABINET: общие элементы раздела проектов — используются в личном
// кабинете (/partner) и в панели обработки заявок (/admin/projects).
// Дизайн повторяет существующие токены проекта: карточки rounded-2xl,
// акцент bg-violet-600 / dark:bg-cyan-500 — новых стилей не вводится.
//
// STAGES: список этапов больше не вшит в компонент. Он приходит из услуги
// проекта, потому что «вёрстка» и «домен» существуют только у сайта, а услуг
// одиннадцать (см. lib/orderStages.ts).

export interface ProjectFileItem { url: string; name: string; size: number }
export interface ProjectPerson { id: string; name: string; username?: string; avatar: string | null }
/** Услуга в том виде, в каком её отдаёт /api/projects. */
export interface ProjectServiceItem { id: string; title: string; icon?: string | null; stages?: unknown }
export interface ProjectItem {
  id: string;
  name: string;
  purpose: string;
  domain: string;
  stepsDone: unknown;
  files: unknown;
  status: string;
  createdAt: string;
  updatedAt: string;
  owner?: ProjectPerson;
  service?: ProjectServiceItem | null;
}

/** Этапы проекта: набор его услуги. */
export function stagesOf(project: ProjectItem): OrderStage[] {
  return stagesForService(project.service);
}

/**
 * Выполненные этапы проекта, приведённые к его набору.
 *
 * Приведение обязательно: администратор мог удалить этап из набора услуги уже
 * после того, как его отметили. Без фильтра список рисовал бы галочку в
 * пустоте, а прогресс считался бы от несуществующей работы.
 */
export function doneOf(project: ProjectItem, stages: OrderStage[] = stagesOf(project)): string[] {
  return normalizeDoneStages(project.stepsDone, stages);
}

/** Готовность проекта в процентах — от длины набора его услуги. */
export function progressOf(project: ProjectItem, stages: OrderStage[] = stagesOf(project)): number {
  return stageProgress(doneOf(project, stages), stages);
}

export function filesOf(project: ProjectItem): ProjectFileItem[] {
  return Array.isArray(project.files) ? (project.files as ProjectFileItem[]) : [];
}

export function formatSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} МБ`;
  return `${Math.max(1, Math.round(size / 1024))} КБ`;
}

export function StatusChip({ status, progress }: { status: string; progress: number }) {
  const launched = status === "LAUNCHED" || progress >= 100;
  const inWork = !launched && (progress > 0 || status === "IN_PROGRESS");
  const cls = launched
    ? "bg-green-500/15 text-green-600 dark:text-green-400"
    : inWork
      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
      : "bg-neutral-100 text-neutral-500 dark:bg-white/10 dark:text-gray-400";
  return <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ${cls}`}>{launched ? "Запущен" : inWork ? "В работе" : "Новая заявка"}</span>;
}

// Прогресс в виде полоски загрузки («готово на N%»).
export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div>
      {label !== undefined && (
        <div className="mb-1 flex items-center justify-between text-[11px] text-neutral-500 dark:text-gray-400">
          <span>{label}</span>
          <span>{value}%</span>
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-white/10">
        <div className="h-full rounded-full bg-violet-600 transition-all duration-500 dark:bg-cyan-500" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}

export function FileChips({ files }: { files: ProjectFileItem[] }) {
  if (!files.length) return <p className="text-xs text-neutral-400">Материалы не загружены</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {files.map((f, i) => (
        <a key={`${f.url}-${i}`} href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2 py-1 text-xs text-neutral-600 transition hover:border-violet-400 dark:border-white/10 dark:text-gray-300 dark:hover:border-cyan-400/60">
          <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          <span className="max-w-40 truncate">{f.name}</span>
          <span className="text-neutral-400">{formatSize(f.size)}</span>
        </a>
      ))}
    </div>
  );
}

// Этапы услуги. Выполненный этап откатить нельзя (его кнопка неактивна),
// поэтому процент готовности только растёт.
export function StepList({ stages, done, onComplete, disabled }: { stages: OrderStage[]; done: string[]; onComplete?: (stage: OrderStage) => void; disabled?: boolean }) {
  return (
    <ul className="space-y-1.5">
      {stages.map((stage, i) => {
        const isDone = done.includes(stage.id);
        const clickable = !!onComplete && !isDone && !disabled;
        return (
          <li key={stage.id}>
            <button
              type="button"
              disabled={!clickable}
              onClick={() => onComplete?.(stage)}
              title={isDone ? "Этап выполнен — откат невозможен" : undefined}
              className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition ${isDone ? "border-transparent bg-violet-500/10 text-violet-700 dark:bg-cyan-500/10 dark:text-cyan-300" : "border-neutral-200 text-neutral-600 dark:border-white/10 dark:text-gray-300"} ${clickable ? "hover:border-violet-400 dark:hover:border-cyan-400/60" : "cursor-default"}`}
            >
              <span className={`grid h-5 w-5 flex-shrink-0 place-items-center rounded-full text-[11px] font-semibold ${isDone ? "bg-violet-600 text-white dark:bg-cyan-500 dark:text-neutral-950" : "border border-neutral-300 text-neutral-400 dark:border-white/20"}`}>{isDone ? "✓" : i + 1}</span>
              {stage.title}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * CHAT: переход в деловой чат по проекту.
 *
 * Раньше здесь стоял отдельный «Чат по проекту» со своим полем ввода — при том
 * что по тому же вопросу у заказчика уже открыт деловой чат по обращению. Двух
 * мест для одного разговора не бывает: бывает разговор, разрезанный пополам, в
 * котором обе стороны уверены, что вторая молчит.
 *
 * Разговор ищется (а при первом переходе — заводится) на сервере, потому что
 * связать проект с обращением можно только там. Клиент лишь ведёт человека по
 * полученному адресу.
 */
export function ProjectChatLink({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const open = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/chat`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.conversationId) {
        setError(data?.error || "Не удалось открыть чат");
        return;
      }
      router.push(`/connect?section=business&conv=${encodeURIComponent(data.conversationId)}`);
    } catch {
      setError("Нет соединения с сервером");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => void open()}
        disabled={busy}
        className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 transition hover:border-violet-400 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-gray-200 dark:hover:border-cyan-400/60 dark:hover:text-cyan-300"
      >
        <ChatIcon size={16} />
        {busy ? "Открываем…" : "Перейти в бизнес-чат"}
      </button>
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  );
}
