"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChannelTaskDTO,
  STATUS_META,
  priorityFromChannel,
  statusFromChannel,
} from "./types";
import { PriorityPill } from "./ui";
import { CloseIcon } from "./icons";
import InfoTooltip from "@/components/ui/InfoTooltip";

/**
 * Modal that lists the chat tasks assigned to the current user (the "связь по
 * нику") and lets them transfer any into the personal workspace canvas for
 * execution. Tasks already present on the canvas are shown as imported.
 */
export default function ImportTasksPanel({
  importedSourceIds,
  onImport,
  onClose,
}: {
  importedSourceIds: Set<string>;
  onImport: (tasks: ChannelTaskDTO[]) => void;
  onClose: () => void;
}) {
  const [tasks, setTasks] = useState<ChannelTaskDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/tasks/assigned")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!alive) return;
        setTasks(Array.isArray(d.tasks) ? d.tasks : []);
      })
      .catch(() => {
        if (alive) setError("Не удалось загрузить задачи.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const pending = useMemo(
    () => tasks.filter((t) => !importedSourceIds.has(t.id)),
    [tasks, importedSourceIds],
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Мои задачи из чата"
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border
          border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-neutral-100 px-5 py-3.5 dark:border-neutral-800">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              Мои задачи из чата{" "}
              <InfoTooltip
                side="bottom"
                text="Сюда попадает всё, что назначили на ваш ник в чате. Перенесите нужное на холст — и работайте с ним как с обычным узлом. У перенесённой карточки остаётся ссылка, по которой можно вернуться к исходной задаче в чате."
              />
            </h2>
          </div>
          {pending.length > 0 && (
            <button
              type="button"
              onClick={() => onImport(pending)}
              className="whitespace-nowrap rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium
                text-white transition-colors hover:bg-neutral-700 dark:bg-white dark:text-neutral-950
                dark:hover:bg-neutral-200"
            >
              Добавить все · {pending.length}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 transition-colors hover:text-neutral-900 dark:hover:text-white"
            aria-label="Закрыть"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <p className="py-10 text-center text-sm text-neutral-400">Загрузка…</p>
          ) : error ? (
            <p className="py-10 text-center text-sm text-neutral-400">{error}</p>
          ) : tasks.length === 0 ? (
            <p className="py-10 text-center text-sm text-neutral-400">
              Вам пока не назначено ни одной задачи.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {tasks.map((task) => {
                const imported = importedSourceIds.has(task.id);
                const p = priorityFromChannel(task.priority);
                const statusLabel = STATUS_META[statusFromChannel(task.status)].label;
                const due = task.dueDate
                  ? new Date(task.dueDate).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
                  : null;
                return (
                  <li
                    key={task.id}
                    className="flex items-start gap-3 rounded-xl border border-neutral-200 px-3 py-2.5
                      dark:border-neutral-800"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-semibold tabular-nums text-neutral-400">
                          #{task.number}
                        </span>
                        <PriorityPill p={p} />
                        <span className="text-[15px] font-medium leading-snug text-neutral-900 dark:text-neutral-100">
                          {task.title}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-neutral-400 dark:text-neutral-500">
                        <span className="truncate">
                          {task.groupName}
                          {task.channelName ? ` · ${task.channelName}` : ""}
                        </span>
                        <span className="uppercase tracking-wider">{statusLabel}</span>
                        {due && <span className="tabular-nums">{due}</span>}
                        {task.checklist.length > 0 && (
                          <span className="tabular-nums">
                            ☑ {task.checklist.filter((c) => c.done).length}/{task.checklist.length}
                          </span>
                        )}
                      </div>
                    </div>
                    {imported ? (
                      <span className="mt-0.5 whitespace-nowrap text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
                        Добавлено
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onImport([task])}
                        className="mt-0.5 whitespace-nowrap rounded-lg border border-neutral-200 px-2.5 py-1
                          text-[11px] font-medium text-neutral-700 transition-colors hover:border-neutral-400
                          dark:border-neutral-700 dark:text-neutral-200 dark:hover:border-neutral-500"
                      >
                        Добавить
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

      </div>
    </div>
  );
}
