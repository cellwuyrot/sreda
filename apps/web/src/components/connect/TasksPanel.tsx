"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import PanelResizer from "./PanelResizer";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import type { ClipboardEvent, DragEvent } from "react";
import { renderContent } from "./messageFormat";
import { useMentions, MentionPopupList, type MentionUser } from "@/components/ui/MentionPopup";
import { ModuleSettingsButton } from "./ModuleSettingsModal";
import BottomSheet from "@/components/mobile/BottomSheet"; // MOBILE-FIX
import { useMobile } from "@/hooks/useMobile"; // MOBILE-FIX
import { playUiSound } from "@/lib/uiSounds"; // FIX-SFX: локальный звук «задача создана»
import { downscaleForChat } from "@/lib/clientImageResize"; // FIX-NOSHARP
import { fetchAllGroupMembers } from "@/lib/groupMembersFetch";
// FIX-ICONS: фирменные SVG-иконки вместо эмодзи (📋 📎 ☑ ✕ 📄)
import { TaskIcon, XIcon, FileIcon, CheckIcon, AttachmentIcon } from "@/components/ui/ConnectIcons";

interface TaskUser {
  id: string;
  name: string;
  username?: string;
}

interface TaskComment {
  id: string;
  content: string;
  mentions: string | null;
  createdAt: string;
  updatedAt: string;
  author: TaskUser;
}

interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  order: number;
}

interface SubtaskStub {
  id: string;
  number: number;
  title: string;
  status: string;
}

interface Attachment {
  id: string;
  name: string;
  url: string;
  mime: string;
  size: number;
  createdAt: string;
  uploader?: TaskUser;
}

interface Task {
  id: string;
  channelId?: string;
  number: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  closedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  creator: TaskUser;
  assignee: TaskUser | null;
  closedBy?: TaskUser | null;
  comments?: TaskComment[];
  tags?: string;
  parentId?: string | null;
  checklist?: ChecklistItem[];
  subtasks?: SubtaskStub[];
  attachments?: Attachment[];
}

/** Max files accepted from the clipboard/file picker in one go (defensive). */
// FIX-TASKVIDEO: видео к задаче (до 5 МБ) — раньше файл просто отклонялся,
// потому что его не было ни в этом списке, ни на сервере.
const ATTACHMENT_ACCEPT = "image/*,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt,.ods,.zip";
const MAX_VIDEO_BYTES = 5 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function isImageAttachment(a: { mime: string }): boolean {
  return a.mime.startsWith("image/");
}

/** FIX-TASKVIDEO: вложение-видео — показываем проигрыватель вместо строки. */
function isVideoAttachment(a: Attachment): boolean {
  return a.mime.startsWith("video/");
}

/** Pull image files out of a paste/drop clipboard payload. */
function imagesFromClipboard(items: DataTransferItemList | null | undefined): File[] {
  if (!items) return [];
  const files: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

interface TasksPanelProps {
  channelId: string;
  channelName: string;
  currentUserId: string;
  canModerate: boolean;
  onBack?: () => void;
  highlightTaskId?: string | null;
  onHighlightConsumed?: () => void;
}

const OPEN_COLUMNS: { key: string; label: string; accent: string }[] = [
  { key: "open", label: "К выполнению", accent: "border-t-neutral-400" },
  { key: "in_progress", label: "В работе", accent: "border-t-amber-400" },
];

const CLOSED_STATUSES = ["done", "failed", "needs_clarification"];

const CLOSED_META: Record<string, { label: string; cls: string }> = {
  done: { label: "Готово", cls: "bg-green-500/15 text-green-600 dark:text-green-400" },
  failed: { label: "Провалено", cls: "bg-red-500/15 text-red-500" },
  needs_clarification: { label: "Требует уточнения", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-300" },
};

const PRIORITY_META: Record<string, { label: string; cls: string }> = {
  high: { label: "Высокий", cls: "bg-red-500/15 text-red-500" },
  normal: { label: "Обычный", cls: "bg-neutral-400/15 text-neutral-500 dark:text-neutral-300" },
  low: { label: "Низкий", cls: "bg-sky-500/15 text-sky-500" },
};

function statusLabel(status: string): string {
  return OPEN_COLUMNS.find((c) => c.key === status)?.label || CLOSED_META[status]?.label || status;
}

// ===== MOBILE-BLOCKS: мобильная доска задач =====
// Блоки колонок слева, список задач справа/снизу. Всё пролистывается.
type MobileTasksBoardProps = {
  tasks: Task[];
  currentUserId: string;
  canModerate: boolean;
  dragId: string | null;
  setDragId: (id: string | null) => void;
  onMove: (taskId: string, status: string) => void;
  onTake: (taskId: string) => void;
  onClose: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onOpen: (taskId: string) => void;
};

const MOBILE_COLUMNS = [
  { key: "open",    label: "К выполнению", color: "text-blue-400",   bg: "bg-blue-500/10 border-blue-500/20" },
  { key: "in_progress", label: "В работе",     color: "text-amber-400",  bg: "bg-amber-500/10 border-amber-500/20" },
  { key: "closed",  label: "Закрытые",      color: "text-green-400",  bg: "bg-green-500/10 border-green-500/20" },
];

const CLOSED_STATUSES_MB = ["done", "failed", "needs_clarification"];

function MobileTasksBoard({
  tasks, currentUserId, canModerate,
  onTake, onClose, onDelete, onOpen,
}: MobileTasksBoardProps) {
  const [activeCol, setActiveCol] = React.useState<string>("open");
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null);

  const getItems = (key: string) => {
    if (key === "closed") {
      return tasks.filter((t) => CLOSED_STATUSES_MB.includes(t.status) && !t.parentId);
    }
    return tasks.filter((t) => t.status === key && !t.parentId);
  };

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Левая панель: блоки колонок */}
      <div className="flex flex-col gap-2 p-3 w-28 flex-shrink-0 border-r border-neutral-200 dark:border-white/10 overflow-y-auto">
        {MOBILE_COLUMNS.map((col) => {
          const count = getItems(col.key).length;
          const isActive = activeCol === col.key;
          return (
            <button
              key={col.key}
              onClick={() => setActiveCol(col.key)}
              className={`flex flex-col items-center justify-center gap-1 p-3 rounded-xl border transition-all text-center ${
                isActive
                  ? col.bg + " " + col.color + " border-current shadow-sm"
                  : "border-neutral-200 dark:border-white/10 text-neutral-500 dark:text-neutral-400 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              }`}
            >
              <span className="text-xs font-semibold leading-tight">{col.label}</span>
              <span className={`text-base font-bold ${ isActive ? col.color : "text-neutral-400 dark:text-neutral-500" }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Список задач */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="p-3 space-y-2">
          {getItems(activeCol).length === 0 ? (
            <div className="text-center text-sm text-neutral-400 dark:text-neutral-500 py-10">
              Нет задач
            </div>
          ) : (
            getItems(activeCol).map((task) => (
              <button
                key={task.id}
                onClick={() => { setSelectedTaskId(task.id); onOpen(task.id); }}
                className="w-full text-left p-3 rounded-xl bg-white dark:bg-neutral-800/80 border border-neutral-200 dark:border-white/10 hover:border-violet-400 dark:hover:border-cyan-500/40 transition-colors shadow-sm"
              >
                <p className="text-sm font-medium text-neutral-900 dark:text-white line-clamp-2">{task.title}</p>
                {task.description && (
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">{task.description}</p>
                )}
                {task.assigneeId && (
                  <p className="text-[11px] text-violet-500 dark:text-cyan-400 mt-1">Назначено</p>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function TasksPanel({ channelId, channelName, currentUserId, canModerate, onBack, highlightTaskId, onHighlightConsumed }: TasksPanelProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  // ФИКС: после отмены создания задачи с введённым текстом кнопка «+ Задача»
  // уходит в явный кулдаун на 15 секунд с часовым циферблатом вместо невидимой блокировки.
  const [addCooldownUntil, setAddCooldownUntil] = useState(0);
  const [cooldownNow, setCooldownNow] = useState(0);
  useEffect(() => {
    if (addCooldownUntil <= Date.now()) return;
    const t = setInterval(() => {
      setCooldownNow(Date.now());
      if (Date.now() >= addCooldownUntil) clearInterval(t);
    }, 100);
    return () => clearInterval(t);
  }, [addCooldownUntil]);
  const addCooldownLeft = Math.max(0, addCooldownUntil - cooldownNow);
  const handleAddClose = (hadDraft?: boolean) => {
    setShowAdd(false);
    if (hadDraft) {
      setCooldownNow(Date.now());
      setAddCooldownUntil(Date.now() + 15_000);
    }
  };
  const [dragId, setDragId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // FIX-UI2: регулируемая ширина панели деталей задачи; сохраняется между сессиями.
  const [detailsWidth, setDetailsWidth] = useState(320);
  /* MOBILE-FIX: на телефоне панель деталей была hidden lg:block — тап по задаче
     не открывал ничего. Теперь детали показываются нижним листом, а системная
     «назад» его закрывает. */
  const isMobileViewport = useMobile();
  useEffect(() => {
    const saved = Number(localStorage.getItem("tz-tasks-details-width"));
    if (Number.isFinite(saved) && saved >= 208 && saved <= 560) setDetailsWidth(saved);
  }, []);
  const changeDetailsWidth = useCallback((w: number) => {
    setDetailsWidth(w);
    localStorage.setItem("tz-tasks-details-width", String(Math.round(w)));
  }, []);
  const [closingTaskId, setClosingTaskId] = useState<string | null>(null);
  const [members, setMembers] = useState<MentionUser[]>([]);

  const fetchTasks = useCallback(() => {
    setLoading(true);
    fetch(`/api/tasks?channelId=${channelId}`)
      .then((r) => r.json())
      .then((d) => setTasks(Array.isArray(d.tasks) ? d.tasks : []))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, [channelId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Deep-link from a notification: open the target task's detail once tasks load.
  useEffect(() => {
    if (!highlightTaskId || loading) return;
    if (tasks.some((task) => task.id === highlightTaskId)) {
      setSelectedTaskId(highlightTaskId);
    }
    onHighlightConsumed?.();
  }, [highlightTaskId, loading, tasks, onHighlightConsumed]);

  // Load group members for assignee picker and @mention autocomplete (channel members only).
  // Исполнителем можно назначить любого, поэтому список нужен полностью: он
  // добирается страницами через /api/groups/[id]/members — снимок сообщества
  // отдаёт только первую.
  useEffect(() => {
    fetch(`/api/channels/${channelId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((ch) => {
        if (!ch?.groupId) return;
        return fetchAllGroupMembers(ch.groupId).then((all) => {
          if (all.length > 0) {
            setMembers(
              all.map((m) => ({
                id: m.user.id,
                name: m.user.name,
                username: m.user.username ?? null,
                avatar: m.user.avatar ?? null,
                lastSeen: m.user.lastSeen ?? null,
              })),
            );
          }
        });
      })
      .catch(() => {});
  }, [channelId]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) || null,
    [selectedTaskId, tasks],
  );

  const closingTask = useMemo(
    () => tasks.find((task) => task.id === closingTaskId) || null,
    [closingTaskId, tasks],
  );

  const move = async (taskId: string, status: string, takeOwnership = false): Promise<void> => {
    const target = tasks.find((task) => task.id === taskId);
    if (target && CLOSED_STATUSES.includes(target.status)) return; // closed tasks are immutable
    if (CLOSED_STATUSES.includes(status)) {
      // Closing requires explicit confirmation
      setClosingTaskId(taskId);
      return;
    }

    setTasks((prev) => prev.map((task) => (
      task.id === taskId
        ? {
            ...task,
            status,
            assignee: takeOwnership && !task.assignee ? { id: currentUserId, name: "Вы", username: "you" } : task.assignee,
          }
        : task
    )));

    await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, takeOwnership }),
    }).catch(() => {});

    fetchTasks();
  };

  const closeTask = async (taskId: string, stage: string): Promise<void> => {
    await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: stage, confirmClose: true }),
    }).catch(() => {});
    setClosingTaskId(null);
    fetchTasks();
  };

  const takeTask = async (taskId: string): Promise<void> => {
    await move(taskId, "in_progress", true);
  };

  const remove = async (taskId: string): Promise<void> => {
    if (!(await confirmDialog({ message: "Удалить задачу?", confirmText: "Удалить", danger: true }))) return;
    setTasks((prev) => prev.filter((task) => task.id !== taskId));
    await fetch(`/api/tasks/${taskId}`, { method: "DELETE" }).catch(() => {});
    if (selectedTaskId === taskId) setSelectedTaskId(null);
    fetchTasks();
  };

  const closedTasks = tasks.filter((task) => CLOSED_STATUSES.includes(task.status) && !task.parentId);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-neutral-200 dark:border-white/10">
        {onBack && (
          <button onClick={onBack} className="md:hidden -ml-2 min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-neutral-500 active:text-neutral-800 dark:active:text-white" aria-label="Открыть каналы">
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M4 6h16M4 12h10M4 18h16" /></svg>
          </button>
        )}
        <TaskIcon size={18} />
        <h2 className="text-base font-semibold text-neutral-900 dark:text-white flex-1 truncate">{channelName}</h2>
        {canModerate && <ModuleSettingsButton channelId={channelId} />}
        <button
          onClick={() => setShowAdd(true)}
          disabled={addCooldownLeft > 0}
          title={addCooldownLeft > 0 ? "Кнопка снова станет активной, когда стрелка завершит круг" : undefined}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-700 dark:bg-cyan-500 dark:hover:bg-cyan-400 text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
        >
          {addCooldownLeft > 0 && <CooldownClock leftMs={addCooldownLeft} totalMs={15_000} />}
          + Задача
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {loading ? (
          <p className="text-center text-sm text-neutral-400 py-8">Загрузка…</p>
        ) : (
          <div className="flex h-full flex-col lg:flex-row">
            {/* MOBILE-BLOCKS: на телефоне показываем блоки колонок слева, список задач справа. */}
            {isMobileViewport ? (
              <MobileTasksBoard
                tasks={tasks}
                currentUserId={currentUserId}
                canModerate={canModerate}
                dragId={dragId}
                setDragId={setDragId}
                onMove={move}
                onTake={takeTask}
                onClose={(taskId) => setClosingTaskId(taskId)}
                onDelete={remove}
                onOpen={setSelectedTaskId}
              />
            ) : (
            <div className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden p-3">
              <div className="flex gap-3 h-full min-w-max">
                {OPEN_COLUMNS.map((col) => {
                  const items = tasks.filter((task) => task.status === col.key && !task.parentId);
                  return (
                    <div
                      key={col.key}
                      onDragOver={(e) => { e.preventDefault(); }}
                      onDrop={() => {
                        if (dragId) {
                          move(dragId, col.key);
                          setDragId(null);
                        }
                      }}
                      className={`flex flex-col w-72 max-md:w-[85vw] md:flex-1 min-w-[18rem] max-md:min-w-0 md:min-w-[12rem] rounded-xl bg-neutral-100 dark:bg-neutral-800/50 border-t-2 ${col.accent}`}
                    >
                      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200 dark:border-white/5">
                        <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">{col.label}</span>
                        <span className="text-xs text-neutral-400 bg-neutral-200 dark:bg-neutral-700 rounded-full px-2">{items.length}</span>
                      </div>
                      <div className="flex-1 overflow-y-auto p-2 space-y-2">
                        {items.length === 0 ? (
                          <p className="text-xs text-neutral-400 text-center py-6">Пусто</p>
                        ) : (
                          items.map((task) => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              currentUserId={currentUserId}
                              canManage={canModerate || task.creator.id === currentUserId || task.assignee?.id === currentUserId}
                              canDelete={canModerate || task.creator.id === currentUserId}
                              onDragStart={() => setDragId(task.id)}
                              onMove={(status) => move(task.id, status)}
                              onTake={() => takeTask(task.id)}
                              onClose={() => setClosingTaskId(task.id)}
                              onDelete={() => remove(task.id)}
                              onOpen={() => setSelectedTaskId(task.id)}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Closed tasks column: dropping here asks for a closing stage */}
                <div
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={() => {
                    if (dragId) {
                      setClosingTaskId(dragId);
                      setDragId(null);
                    }
                  }}
                  className="flex flex-col w-72 max-md:w-[85vw] md:flex-1 min-w-[18rem] max-md:min-w-0 md:min-w-[12rem] rounded-xl bg-neutral-100 dark:bg-neutral-800/50 border-t-2 border-t-green-500"
                >
                  <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200 dark:border-white/5">
                    <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">Закрытые</span>
                    <span className="text-xs text-neutral-400 bg-neutral-200 dark:bg-neutral-700 rounded-full px-2">{closedTasks.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {closedTasks.length === 0 ? (
                      <p className="text-xs text-neutral-400 text-center py-6">Пусто</p>
                    ) : (
                      closedTasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          currentUserId={currentUserId}
                          canManage={false}
                          canDelete={canModerate || task.creator.id === currentUserId}
                          onDragStart={() => {}}
                          onMove={() => {}}
                          onTake={() => {}}
                          onClose={() => {}}
                          onDelete={() => remove(task.id)}
                          onOpen={() => setSelectedTaskId(task.id)}
                        />
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
            )} {/* end desktop kanban */}

            {/* FIX-UI2: ширина панели «Выберите задачу…» теперь регулируется
                перетаскиванием рукоятки на границе с колонками (двойной клик —
                сброс к 320px). Значение сохраняется в localStorage. */}
            <div className="hidden lg:contents">
              <PanelResizer width={detailsWidth} min={208} max={560} onChange={changeDetailsWidth} resetWidth={320} edge="right" />
            </div>
            <div style={{ width: detailsWidth }} className="hidden lg:block flex-shrink-0 min-w-0 border-l border-neutral-200 dark:border-white/10 bg-white/50 dark:bg-neutral-900/40 overflow-y-auto overflow-x-hidden">
              <TaskDetailsPanel
                task={selectedTask}
                currentUserId={currentUserId}
                canModerate={canModerate}
                members={members}
                onRefresh={fetchTasks}
                onTake={takeTask}
                onMove={move}
                onRequestClose={(taskId) => setClosingTaskId(taskId)}
                onDelete={remove}
                onOpenTask={setSelectedTaskId}
              />
            </div>

            {/* MOBILE-FIX: на телефоне/планшете (< lg) детали задачи открываются
                нижним листом — раньше панель была hidden lg:block и тап по
                задаче не давал ничего. */}
            {isMobileViewport && (
              <BottomSheet
                open={!!selectedTask}
                onClose={() => setSelectedTaskId(null)}
                height="88%"
                title={selectedTask?.title ?? "Задача"}
              >
                <TaskDetailsPanel
                  task={selectedTask}
                  currentUserId={currentUserId}
                  canModerate={canModerate}
                  members={members}
                  onRefresh={fetchTasks}
                  onTake={takeTask}
                  onMove={move}
                  onRequestClose={(taskId) => setClosingTaskId(taskId)}
                  onDelete={remove}
                  onOpenTask={setSelectedTaskId}
                />
              </BottomSheet>
            )}
          </div>
        )}
      </div>

      {selectedTask && (
        <TaskDetailsModal
          task={selectedTask}
          currentUserId={currentUserId}
          canModerate={canModerate}
          members={members}
          onClose={() => setSelectedTaskId(null)}
          onRefresh={fetchTasks}
          onTake={takeTask}
          onMove={move}
          onRequestClose={(taskId) => setClosingTaskId(taskId)}
          onDelete={remove}
          onOpenTask={setSelectedTaskId}
        />
      )}

      {closingTask && !CLOSED_STATUSES.includes(closingTask.status) && (
        <TaskCloseModal
          task={closingTask}
          onCancel={() => setClosingTaskId(null)}
          onConfirm={(stage) => closeTask(closingTask.id, stage)}
        />
      )}

      {showAdd && (
        <TaskAddModal
          channelId={channelId}
          members={members}
          onClose={handleAddClose}
          onCreated={() => { setShowAdd(false); fetchTasks(); }}
        />
      )}
    </div>
  );
}

function TaskCard({ task, currentUserId, canManage, canDelete, onDragStart, onMove, onTake, onClose, onDelete, onOpen }: {
  task: Task;
  currentUserId: string;
  canManage: boolean;
  canDelete: boolean;
  onDragStart: () => void;
  onMove: (status: string) => void;
  onTake: () => void;
  onClose: () => void;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const prio = PRIORITY_META[task.priority] || PRIORITY_META.normal;
  const isClosed = CLOSED_STATUSES.includes(task.status);
  const closedMeta = isClosed ? CLOSED_META[task.status] : null;
  const overdue = task.dueDate && !isClosed && new Date(task.dueDate) < new Date();
  const canTake = !isClosed && task.status === "open" && task.assignee?.id !== currentUserId;

  return (
    <div
      draggable={canManage && !isClosed}
      onDragStart={onDragStart}
      className={`group rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-white/5 p-2.5 shadow-sm hover:shadow transition-shadow ${isClosed ? "opacity-75" : "cursor-grab active:cursor-grabbing"}`}
    >
      <div className="flex items-start gap-2">
        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-300">#{task.number}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${prio.cls}`}>{prio.label}</span>
        {closedMeta && <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${closedMeta.cls}`}>{closedMeta.label}</span>}
        {canDelete && (
          <button onClick={onDelete} className="ml-auto opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-500 transition-opacity" title="Удалить">
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        )}
      </div>
      <button onClick={onOpen} className="w-full text-left">
        <p className={`text-sm font-medium mt-1.5 ${isClosed ? "text-neutral-500 dark:text-neutral-400 line-through" : "text-neutral-900 dark:text-white"}`}>{task.title}</p>
        {task.description && <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-3 whitespace-pre-wrap">{renderContent(task.description)}</p>}
      </button>
      {!!task.tags && task.tags.split(",").filter(Boolean).length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {task.tags.split(",").filter(Boolean).map((t) => (
            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 dark:bg-cyan-400/10 text-violet-600 dark:text-cyan-300">#{t}</span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 mt-2 flex-wrap text-[11px] text-neutral-400">
        {task.assignee && (
          <span className="inline-flex items-center gap-1">
            <span className="w-4 h-4 rounded-full bg-violet-500/20 dark:bg-cyan-500/20 text-violet-600 dark:text-cyan-400 flex items-center justify-center text-[9px] font-semibold">
              {task.assignee.name.charAt(0).toUpperCase()}
            </span>
            @{task.assignee.username || task.assignee.name}
          </span>
        )}
        {!!task.comments?.length && <span>{task.comments.length} комм.</span>}
        {!!task.attachments?.length && <span className="inline-flex items-center gap-0.5"><AttachmentIcon size={11} style={{ color: "inherit" }} /> {task.attachments.length}</span>}
        {!!task.checklist?.length && (
          <span className="inline-flex items-center gap-0.5"><CheckIcon size={11} style={{ color: "inherit" }} /> {task.checklist.filter((c) => c.done).length}/{task.checklist.length}</span>
        )}
        {!!task.subtasks?.length && (
          <span>⤷ {task.subtasks.filter((s) => CLOSED_STATUSES.includes(s.status)).length}/{task.subtasks.length}</span>
        )}
        {task.dueDate && (
          <span className={overdue ? "text-red-500 font-medium" : ""}>
            {new Date(task.dueDate).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
          </span>
        )}
      </div>
      {!isClosed && (
        <div className="flex gap-1 mt-2 pt-2 border-t border-neutral-100 dark:border-white/5 flex-wrap">
          {canTake && (
            <button onClick={onTake} className="text-[10px] px-2 py-1 rounded bg-amber-500/15 text-amber-600 dark:text-amber-300 hover:bg-amber-500/25 transition-colors">
              Взять в работу
            </button>
          )}
          {canManage && OPEN_COLUMNS.filter((column) => column.key !== task.status).map((column) => (
            <button key={column.key} onClick={() => onMove(column.key)} className="flex-1 text-[10px] px-1.5 py-1 rounded bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-violet-500/15 hover:text-violet-600 dark:hover:text-cyan-400 transition-colors truncate">
              {column.label}
            </button>
          ))}
          {canManage && (
            <button onClick={onClose} className="flex-1 text-[10px] px-1.5 py-1 rounded bg-green-500/15 text-green-600 dark:text-green-400 hover:bg-green-500/25 transition-colors truncate">
              Закрыть…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TaskCloseModal({ task, onCancel, onConfirm }: {
  task: Task;
  onCancel: () => void;
  onConfirm: (stage: string) => void;
}) {
  const [stage, setStage] = useState("done");
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    setSaving(true);
    await onConfirm(stage);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onCancel} role="dialog" aria-modal="true" aria-label="Подтверждение закрытия задачи">
      <div className="w-full max-w-md bg-white dark:bg-neutral-900 rounded-2xl p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-neutral-900 dark:text-white mb-1">Закрыть задачу #{task.number}?</h3>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
          {"Закрытую задачу нельзя будет вернуть в работу. Это действие необратимо."}
        </p>
        <div className="space-y-2 mb-5">
          {CLOSED_STATUSES.map((key) => (
            <label key={key} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${stage === key ? "border-violet-500 dark:border-cyan-400 bg-violet-500/5 dark:bg-cyan-400/5" : "border-neutral-200 dark:border-white/10 hover:bg-neutral-50 dark:hover:bg-white/5"}`}>
              <input type="radio" name="close-stage" value={key} checked={stage === key} onChange={() => setStage(key)} className="accent-violet-600 dark:accent-cyan-400" />
              <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${CLOSED_META[key].cls}`}>{CLOSED_META[key].label}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800">Отмена</button>
          <button onClick={confirm} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-50">
            {saving ? "…" : "Закрыть безвозвратно"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskDetailsPanel({ task, currentUserId, canModerate, members, onRefresh, onTake, onMove, onRequestClose, onDelete, onOpenTask }: {
  task: Task | null;
  currentUserId: string;
  canModerate: boolean;
  members: MentionUser[];
  onRefresh: () => void;
  onTake: (taskId: string) => Promise<void>;
  onMove: (taskId: string, status: string) => Promise<void>;
  onRequestClose: (taskId: string) => void;
  onDelete: (taskId: string) => Promise<void>;
  onOpenTask: (taskId: string) => void;
}) {
  if (!task) {
    return <div className="h-full min-w-0 flex items-center justify-center text-center text-sm text-neutral-400 p-6 break-words">Выберите задачу, чтобы открыть полный текст и комментарии.</div>;
  }

  return (
    <TaskDetailsContent
      task={task}
      currentUserId={currentUserId}
      canModerate={canModerate}
      members={members}
      onRefresh={onRefresh}
      onTake={onTake}
      onMove={onMove}
      onRequestClose={onRequestClose}
      onDelete={onDelete}
      onOpenTask={onOpenTask}
    />
  );
}

function TaskDetailsModal({ task, currentUserId, canModerate, members, onClose, onRefresh, onTake, onMove, onRequestClose, onDelete, onOpenTask }: {
  task: Task;
  currentUserId: string;
  canModerate: boolean;
  members: MentionUser[];
  onClose: () => void;
  onRefresh: () => void;
  onTake: (taskId: string) => Promise<void>;
  onMove: (taskId: string, status: string) => Promise<void>;
  onRequestClose: (taskId: string) => void;
  onDelete: (taskId: string) => Promise<void>;
  onOpenTask: (taskId: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 lg:hidden" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl bg-white dark:bg-neutral-900 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <TaskDetailsContent
          task={task}
          currentUserId={currentUserId}
          canModerate={canModerate}
          members={members}
          onRefresh={onRefresh}
          onTake={onTake}
          onMove={onMove}
          onRequestClose={onRequestClose}
          onDelete={onDelete}
          onOpenTask={onOpenTask}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

function TaskDetailsContent({ task, currentUserId, canModerate, members, onRefresh, onTake, onMove, onRequestClose, onDelete, onOpenTask, onClose }: {
  task: Task;
  currentUserId: string;
  canModerate: boolean;
  members: MentionUser[];
  onRefresh: () => void;
  onTake: (taskId: string) => Promise<void>;
  onMove: (taskId: string, status: string) => Promise<void>;
  onRequestClose: (taskId: string) => void;
  onDelete: (taskId: string) => Promise<void>;
  onOpenTask: (taskId: string) => void;
  onClose?: () => void;
}) {
  const [comment, setComment] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [error, setError] = useState("");
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const isClosed = CLOSED_STATUSES.includes(task.status);
  const canManage = !isClosed && (canModerate || task.creator.id === currentUserId || task.assignee?.id === currentUserId);
  const canDelete = canModerate || task.creator.id === currentUserId;
  const canTake = !isClosed && task.status === "open" && task.assignee?.id !== currentUserId;

  const [tagInput, setTagInput] = useState("");
  const [checklistInput, setChecklistInput] = useState("");
  const [subtaskInput, setSubtaskInput] = useState("");
  const [savingSubtask, setSavingSubtask] = useState(false);
  const tags = (task.tags || "").split(",").filter(Boolean);

  // ── Attachments (documents/images) ──
  const attachments = task.attachments ?? [];
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachError, setAttachError] = useState("");
  const [attachDragOver, setAttachDragOver] = useState(false);

  const uploadAttachments = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setUploadingAttachment(true);
    setAttachError("");
    try {
      for (const file of files) {
        /* FIX-TASKVIDEO: видео крупнее лимита отсекаем сразу — не гоняем
           мегабайты по сети ради ответа «слишком большое». */
        if (file.type.startsWith("video/") && file.size > MAX_VIDEO_BYTES) {
          setAttachError(`Видео «${file.name}» больше 5 МБ`);
          continue;
        }
        const fd = new FormData();
        // FIX-NOSHARP: уменьшаем в браузере — на сервере обработки больше нет.
        fd.append("file", await downscaleForChat(file));
        const res = await fetch(`/api/tasks/${task.id}/attachments`, { method: "POST", body: fd });
        if (!res.ok) {
          /* 413 отдаёт обратный прокси (nginx) — тело не JSON, поэтому
             отдельная понятная подсказка вместо «Не удалось загрузить файл». */
          if (res.status === 413) {
            setAttachError("Файл слишком большой — сервер отклонил загрузку");
            continue;
          }
          const data = await res.json().catch(() => ({}));
          setAttachError(data.error || "Не удалось загрузить файл");
        }
      }
    } finally {
      setUploadingAttachment(false);
      onRefresh();
    }
  }, [task.id, onRefresh]);

  const removeAttachment = async (attachmentId: string) => {
    await fetch(`/api/tasks/${task.id}/attachments?attachmentId=${attachmentId}`, { method: "DELETE" }).catch(() => {});
    onRefresh();
  };

  const handleAttachmentDrop = (e: DragEvent) => {
    e.preventDefault();
    setAttachDragOver(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) uploadAttachments(files);
  };

  // Point 2: pasting a screenshot / copied image straight into the task uploads
  // it as an attachment. Non-image clipboard payloads fall through untouched.
  const handlePasteImages = (e: ClipboardEvent) => {
    const imgs = imagesFromClipboard(e.clipboardData?.items);
    if (imgs.length > 0) {
      e.preventDefault();
      uploadAttachments(imgs);
    }
  };

  const saveTags = async (nextTags: string[]) => {
    await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: nextTags }),
    }).catch(() => {});
    onRefresh();
  };

  const addTag = () => {
    const value = tagInput.trim().toLowerCase();
    if (!value || tags.includes(value)) { setTagInput(""); return; }
    setTagInput("");
    saveTags([...tags, value]);
  };

  const removeTag = (t: string) => saveTags(tags.filter((tag) => tag !== t));

  const addChecklistItem = async () => {
    if (!checklistInput.trim()) return;
    const text = checklistInput.trim();
    setChecklistInput("");
    await fetch(`/api/tasks/${task.id}/checklist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).catch(() => {});
    onRefresh();
  };

  const toggleChecklistItem = async (itemId: string, done: boolean) => {
    await fetch(`/api/tasks/${task.id}/checklist`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, done }),
    }).catch(() => {});
    onRefresh();
  };

  const deleteChecklistItem = async (itemId: string) => {
    await fetch(`/api/tasks/${task.id}/checklist?itemId=${itemId}`, { method: "DELETE" }).catch(() => {});
    onRefresh();
  };

  const addSubtask = async () => {
    if (!subtaskInput.trim() || !task.channelId) return;
    setSavingSubtask(true);
    const title = subtaskInput.trim();
    try {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: task.channelId, title, parentId: task.id }),
      });
      playUiSound("taskCreate"); // FIX-SFX: подзадача создана (звук только у автора)
      setSubtaskInput("");
      onRefresh();
    } finally {
      setSavingSubtask(false);
    }
  };

  const mentions = useMentions({
    members,
    includeEveryone: false,
    onApply: (next, caretAfter) => {
      setComment(next);
      requestAnimationFrame(() => {
        const ta = commentRef.current;
        if (ta) {
          ta.focus();
          ta.selectionStart = caretAfter;
          ta.selectionEnd = caretAfter;
        }
      });
    },
  });

  const submitComment = async () => {
    if (!comment.trim()) return;
    setSavingComment(true);
    setError("");
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: comment }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Не удалось сохранить комментарий");
      }
      setComment("");
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить комментарий");
    } finally {
      setSavingComment(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-3 border-b border-neutral-200 dark:border-white/10 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-neutral-400">#{task.number}</span>
            <h3 className="text-lg font-semibold text-neutral-900 dark:text-white break-words">{task.title}</h3>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${(PRIORITY_META[task.priority] || PRIORITY_META.normal).cls}`}>{(PRIORITY_META[task.priority] || PRIORITY_META.normal).label}</span>
            {isClosed && CLOSED_META[task.status] && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${CLOSED_META[task.status].cls}`}>{CLOSED_META[task.status].label}</span>
            )}
          </div>
          <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400 flex flex-wrap gap-3">
            <span>Автор: @{task.creator.username || task.creator.name}</span>
            <span>Исполнитель: {task.assignee ? `@${task.assignee.username || task.assignee.name}` : "не назначен"}</span>
            <span>Статус: {statusLabel(task.status)}</span>
            {isClosed && task.closedAt && (
              <span>
                Закрыта {new Date(task.closedAt).toLocaleString("ru-RU")}
                {task.closedBy ? ` (@${task.closedBy.username || task.closedBy.name})` : ""}
              </span>
            )}
          </div>
        </div>
        {onClose && <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-white" aria-label="Закрыть"><XIcon size={16} style={{ color: "inherit" }} /></button>}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <section>
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-2">Описание</div>
          <div className="rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 p-4 text-sm text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap break-words">
            {task.description ? renderContent(task.description) : "Описание не заполнено."}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Вложения</div>
            <button
              onClick={() => attachInputRef.current?.click()}
              disabled={uploadingAttachment}
              className="text-[11px] px-2 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-violet-500/15 hover:text-violet-600 dark:hover:text-cyan-400 transition-colors disabled:opacity-50 inline-flex items-center gap-1"
            >
              <AttachmentIcon size={12} style={{ color: "inherit" }} /> {uploadingAttachment ? "Загрузка…" : "Прикрепить"}
            </button>
          </div>
          <input
            ref={attachInputRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(e) => { uploadAttachments(Array.from(e.target.files ?? [])); e.target.value = ""; }}
          />
          {attachError && <p className="text-xs text-red-500 mb-2">{attachError}</p>}
          <div
            tabIndex={0}
            onDragOver={(e) => { e.preventDefault(); setAttachDragOver(true); }}
            onDragLeave={() => setAttachDragOver(false)}
            onDrop={handleAttachmentDrop}
            onPaste={handlePasteImages}
            className={`rounded-xl border border-dashed p-2 outline-none transition-colors focus:border-violet-400 dark:focus:border-cyan-400 ${attachDragOver ? "border-violet-400 bg-violet-500/5" : "border-neutral-200 dark:border-white/10"}`}
          >
            {attachments.length > 0 && (
              <div className="grid grid-cols-2 gap-2 mb-2">
                {attachments.map((att) => (
                  <AttachmentTile
                    key={att.id}
                    attachment={att}
                    onRemove={
                      att.uploader?.id === currentUserId || canModerate || task.creator.id === currentUserId
                        ? () => removeAttachment(att.id)
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
            <p className="text-[11px] text-neutral-400 text-center px-2 py-1 leading-relaxed">
              Перетащите файлы сюда, вставьте изображение из буфера обмена (Ctrl+V) или нажмите «Прикрепить». Фото и документы до 25 МБ.
            </p>
          </div>
        </section>

        <section>
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-2">Теги</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-violet-500/10 dark:bg-cyan-400/10 text-violet-600 dark:text-cyan-300">
                #{t}
                {canManage && (
                  <button onClick={() => removeTag(t)} className="hover:text-red-500" aria-label={`Удалить тег ${t}`}><XIcon size={10} style={{ color: "inherit" }} /></button>
                )}
              </span>
            ))}
            {tags.length === 0 && !canManage && <span className="text-xs text-neutral-400">Тегов нет</span>}
            {canManage && (
              <div className="flex items-center gap-1">
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                  placeholder="+ тег"
                  maxLength={30}
                  className="w-20 px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-xs text-neutral-900 dark:text-white outline-none focus:ring-1 ring-violet-500 dark:ring-cyan-400"
                />
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Чек-лист</div>
            {!!task.checklist?.length && (
              <span className="text-[11px] text-neutral-400">{task.checklist.filter((c) => c.done).length}/{task.checklist.length}</span>
            )}
          </div>
          <div className="space-y-1.5">
            {task.checklist?.map((item) => (
              <label key={item.id} className="flex items-center gap-2 group rounded-lg px-2 py-1 hover:bg-neutral-50 dark:hover:bg-white/5">
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled={isClosed}
                  onChange={(e) => toggleChecklistItem(item.id, e.target.checked)}
                  className="accent-violet-600 dark:accent-cyan-400"
                />
                <span className={`flex-1 text-sm ${item.done ? "line-through text-neutral-400" : "text-neutral-800 dark:text-neutral-200"}`}>{item.text}</span>
                {canManage && (
                  <button onClick={() => deleteChecklistItem(item.id)} className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-500" aria-label="Удалить пункт"><XIcon size={12} style={{ color: "inherit" }} /></button>
                )}
              </label>
            ))}
            {!task.checklist?.length && <p className="text-xs text-neutral-400 px-2">Пунктов пока нет.</p>}
          </div>
          {canManage && (
            <div className="flex gap-2 mt-2">
              <input
                value={checklistInput}
                onChange={(e) => setChecklistInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addChecklistItem(); } }}
                placeholder="Добавить пункт чек-листа"
                maxLength={200}
                className="flex-1 px-3 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-sm text-neutral-900 dark:text-white outline-none focus:ring-2 ring-violet-500 dark:ring-cyan-400"
              />
              <button onClick={addChecklistItem} disabled={!checklistInput.trim()} className="px-3 py-1.5 rounded-lg text-sm bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:bg-violet-500/15 disabled:opacity-50">
                +
              </button>
            </div>
          )}
        </section>

        {!task.parentId && (
          <section>
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-2">Подзадачи</div>
            <div className="space-y-1.5">
              {task.subtasks?.map((sub) => {
                const subClosed = CLOSED_STATUSES.includes(sub.status);
                return (
                  <button
                    key={sub.id}
                    onClick={() => onOpenTask(sub.id)}
                    className="w-full flex items-center gap-2 rounded-lg border border-neutral-200 dark:border-white/10 px-3 py-1.5 text-left hover:bg-neutral-50 dark:hover:bg-white/5"
                  >
                    <span className="text-[10px] text-neutral-400">#{sub.number}</span>
                    <span className={`flex-1 text-sm truncate ${subClosed ? "line-through text-neutral-400" : "text-neutral-800 dark:text-neutral-200"}`}>{sub.title}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${subClosed ? (CLOSED_META[sub.status]?.cls || "") : "bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-300"}`}>
                      {statusLabel(sub.status)}
                    </span>
                  </button>
                );
              })}
              {!task.subtasks?.length && <p className="text-xs text-neutral-400 px-1">Подзадач пока нет.</p>}
            </div>
            {canManage && (
              <div className="flex gap-2 mt-2">
                <input
                  value={subtaskInput}
                  onChange={(e) => setSubtaskInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSubtask(); } }}
                  placeholder="Название подзадачи"
                  maxLength={200}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-sm text-neutral-900 dark:text-white outline-none focus:ring-2 ring-violet-500 dark:ring-cyan-400"
                />
                <button onClick={addSubtask} disabled={savingSubtask || !subtaskInput.trim()} className="px-3 py-1.5 rounded-lg text-sm bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:bg-violet-500/15 disabled:opacity-50">
                  +
                </button>
              </div>
            )}
          </section>
        )}

        {task.parentId && (
          <button onClick={() => onOpenTask(task.parentId!)} className="text-xs text-violet-600 dark:text-cyan-400 hover:underline">
            ← Вернуться к родительской задаче
          </button>
        )}

        <section>
          {isClosed ? (
            <p className="text-xs text-neutral-400">Задача закрыта — вернуть её в работу нельзя.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {canTake && (
                <button onClick={() => onTake(task.id)} className="px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 text-sm">
                  Взять в работу
                </button>
              )}
              {canManage && OPEN_COLUMNS.filter((column) => column.key !== task.status).map((column) => (
                <button key={column.key} onClick={() => onMove(task.id, column.key)} className="px-3 py-1.5 rounded-lg bg-neutral-100 dark:bg-white/10 text-sm text-neutral-700 dark:text-neutral-200">
                  Переместить в «{column.label}»
                </button>
              ))}
              {canManage && (
                <button onClick={() => onRequestClose(task.id)} className="px-3 py-1.5 rounded-lg bg-green-500/15 text-green-700 dark:text-green-400 text-sm">
                  Закрыть задачу…
                </button>
              )}
              {canDelete && (
                <button onClick={() => onDelete(task.id)} className="px-3 py-1.5 rounded-lg bg-red-100 dark:bg-red-900/40 text-red-600 text-sm">
                  Удалить задачу
                </button>
              )}
            </div>
          )}
        </section>

        <section>
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-2">Комментарии</div>
          <div className="space-y-3">
            {task.comments?.length ? task.comments.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-white/5 p-3">
                <div className="flex items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400 mb-1">
                  <span>@{entry.author.username || entry.author.name}</span>
                  <span>{new Date(entry.createdAt).toLocaleString("ru-RU")}</span>
                </div>
                <div className="text-sm text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap break-words">{renderContent(entry.content)}</div>
              </div>
            )) : (
              <p className="text-sm text-neutral-400">Комментариев пока нет.</p>
            )}
          </div>
          <div className="mt-3">
            {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
            <div className="relative">
              {mentions.open && (
                <MentionPopupList
                  entries={mentions.entries}
                  activeIndex={mentions.activeIndex}
                  onPick={(entry) => mentions.pick(entry, comment)}
                  onHover={mentions.setActiveIndex}
                />
              )}
              <textarea
                ref={commentRef}
                value={comment}
                onChange={(e) => { setComment(e.target.value); mentions.update(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
                onKeyDown={(e) => { mentions.handleKeyDown(e, comment); }}
                onClick={(e) => mentions.update(comment, e.currentTarget.selectionStart ?? comment.length)}
                onPaste={handlePasteImages}
                onBlur={() => setTimeout(mentions.close, 150)}
                placeholder="Добавьте комментарий. Упоминания через @username. Скриншот можно вставить через Ctrl+V"
                rows={4}
                maxLength={5000}
                className="w-full rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white text-sm outline-none focus:ring-2 ring-violet-500 dark:ring-cyan-400 resize-none px-3 py-2"
              />
            </div>
            <div className="mt-2 flex justify-end">
              <button onClick={submitComment} disabled={savingComment || !comment.trim()} className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-700 dark:bg-cyan-500 dark:hover:bg-cyan-400 text-white disabled:opacity-50">
                {savingComment ? "Сохранение…" : "Добавить комментарий"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function AttachmentTile({ attachment, onRemove }: { attachment: Attachment; onRemove?: () => void }) {
  const isImg = isImageAttachment(attachment);
  const isVideo = isVideoAttachment(attachment); // FIX-TASKVIDEO

  // FIX-TASKVIDEO: видео разворачивается в проигрыватель на всю ширину карточки —
  // ролик к задаче обычно нужно посмотреть на месте, а не скачивать.
  if (isVideo) {
    return (
      <div className="group relative rounded-lg border border-neutral-200 dark:border-white/10 bg-white dark:bg-white/5 p-2">
        <video
          src={attachment.url}
          controls
          preload="metadata"
          playsInline
          className="w-full max-h-56 rounded bg-black object-contain"
        />
        <div className="mt-1.5 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <a
              href={attachment.url}
              download={attachment.name}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-xs font-medium text-neutral-800 dark:text-neutral-200 hover:text-violet-600 dark:hover:text-cyan-400"
              title={attachment.name}
            >
              {attachment.name}
            </a>
            <span className="text-[10px] text-neutral-400">{formatBytes(attachment.size)}</span>
          </div>
          {onRemove && (
            <button
              onClick={onRemove}
              className="flex-shrink-0 text-neutral-400 hover:text-red-500 transition-colors"
              aria-label={`Удалить вложение ${attachment.name}`}
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="group relative flex items-center gap-2 rounded-lg border border-neutral-200 dark:border-white/10 bg-white dark:bg-white/5 p-2">
      {isImg ? (
        <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={attachment.url} alt={attachment.name} className="h-14 w-14 rounded object-cover" />
        </a>
      ) : (
        <div className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded bg-neutral-100 dark:bg-neutral-800"><FileIcon size={18} tone="muted" /></div>
      )}
      <div className="min-w-0 flex-1">
        <a
          href={attachment.url}
          download={attachment.name}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-xs font-medium text-neutral-800 dark:text-neutral-200 hover:text-violet-600 dark:hover:text-cyan-400"
          title={attachment.name}
        >
          {attachment.name}
        </a>
        <span className="text-[10px] text-neutral-400">{formatBytes(attachment.size)}</span>
      </div>
      {onRemove && (
        <button
          onClick={onRemove}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-500 transition-opacity"
          aria-label={`Удалить вложение ${attachment.name}`}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      )}
    </div>
  );
}

/** A locally-staged file (chosen or pasted before the task exists yet). */
function PendingFileTile({ file, onRemove }: { file: File; onRemove: () => void }) {
  const isImg = file.type.startsWith("image/");
  const previewUrl = useMemo(() => (isImg ? URL.createObjectURL(file) : null), [file, isImg]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  return (
    <div className="group relative flex items-center gap-2 rounded-lg border border-neutral-200 dark:border-white/10 bg-white dark:bg-white/5 p-2">
      {isImg && previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt={file.name} className="h-10 w-10 flex-shrink-0 rounded object-cover" />
      ) : (
        <div className="flex-shrink-0 flex h-9 w-9 items-center justify-center rounded bg-neutral-100 dark:bg-neutral-800"><FileIcon size={16} tone="muted" /></div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-neutral-800 dark:text-neutral-200" title={file.name}>{file.name}</p>
        <span className="text-[10px] text-neutral-400">{formatBytes(file.size)}</span>
      </div>
      <button onClick={onRemove} className="flex-shrink-0 text-neutral-400 hover:text-red-500 transition-colors" aria-label={`Убрать ${file.name}`}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  );
}

function TaskAddModal({ channelId, members, onClose, onCreated }: {
  channelId: string;
  members: MentionUser[];
  onClose: (hadDraft?: boolean) => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [startInProgress, setStartInProgress] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // FIX-UI3: подтверждение выхода из создания — черновик не должен «слетать»
  // от случайного клика мимо окна.
  const [confirmExit, setConfirmExit] = useState(false);
  const descRef = useRef<HTMLTextAreaElement>(null);

  // Files chosen/pasted before the task exists; uploaded right after creation.
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const addFileRef = useRef<HTMLInputElement>(null);
  const stageFiles = (files: File[]) => { if (files.length) setPendingFiles((prev) => [...prev, ...files]); };
  const removePendingFile = (idx: number) => setPendingFiles((prev) => prev.filter((_, i) => i !== idx));

  // FIX-UI3: есть ли несохранённые данные в форме
  const hasDraft = Boolean(
    title.trim() || description.trim() || tagsInput.trim() || assigneeId || dueDate || pendingFiles.length > 0,
  );
  const requestClose = () => {
    if (hasDraft) setConfirmExit(true);
    else onClose(false);
  };

  const mentions = useMentions({
    members,
    includeEveryone: false,
    onApply: (next, caretAfter) => {
      setDescription(next);
      requestAnimationFrame(() => {
        const ta = descRef.current;
        if (ta) {
          ta.focus();
          ta.selectionStart = caretAfter;
          ta.selectionEnd = caretAfter;
        }
      });
    },
  });

  const submit = async () => {
    if (!title.trim()) {
      setError("Введите название");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId,
          title,
          description,
          priority,
          assigneeId: assigneeId || undefined,
          dueDate: dueDate || undefined,
          startInProgress,
          tags: tagsInput.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Ошибка");
      }
      // Now that the task has an id, upload any staged attachments to it.
      if (pendingFiles.length > 0) {
        const created = await res.json().catch(() => null);
        const taskId: string | undefined = created?.task?.id;
        if (taskId) {
          for (const file of pendingFiles) {
            const fd = new FormData();
            // FIX-NOSHARP: уменьшаем в браузере.
            fd.append("file", await downscaleForChat(file));
            await fetch(`/api/tasks/${taskId}/attachments`, { method: "POST", body: fd }).catch(() => {});
          }
        }
      }
      playUiSound("taskCreate"); // FIX-SFX: задача создана (звук только у автора)
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={requestClose}>
      <div className="relative w-full max-w-md bg-white dark:bg-neutral-900 rounded-2xl p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-neutral-900 dark:text-white mb-4">Новая задача</h3>
        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название задачи" maxLength={200} className="w-full mb-3 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white text-sm outline-none focus:ring-2 ring-violet-500 dark:ring-cyan-400" />
        <div className="relative mb-3">
          {mentions.open && (
            <MentionPopupList
              entries={mentions.entries}
              activeIndex={mentions.activeIndex}
              onPick={(entry) => mentions.pick(entry, description)}
              onHover={mentions.setActiveIndex}
            />
          )}
          <textarea
            ref={descRef}
            value={description}
            onChange={(e) => { setDescription(e.target.value); mentions.update(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
            onKeyDown={(e) => { mentions.handleKeyDown(e, description); }}
            onClick={(e) => mentions.update(description, e.currentTarget.selectionStart ?? description.length)}
            onPaste={(e) => { const imgs = imagesFromClipboard(e.clipboardData?.items); if (imgs.length) { e.preventDefault(); stageFiles(imgs); } }}
            onBlur={() => setTimeout(mentions.close, 150)}
            placeholder="Описание. Можно писать @username. Скриншот — через Ctrl+V"
            rows={4}
            maxLength={5000}
            className="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white text-sm outline-none focus:ring-2 ring-violet-500 dark:ring-cyan-400 resize-none"
          />
        </div>

        {/* Attachments (staged locally, uploaded after the task is created) */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Вложения</span>
            <button
              type="button"
              onClick={() => addFileRef.current?.click()}
              className="text-[11px] px-2 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-violet-500/15 hover:text-violet-600 dark:hover:text-cyan-400 transition-colors inline-flex items-center gap-1"
            >
              <AttachmentIcon size={12} style={{ color: "inherit" }} /> Прикрепить
            </button>
          </div>
          <input
            ref={addFileRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(e) => { stageFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
          />
          {pendingFiles.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {pendingFiles.map((file, idx) => (
                <PendingFileTile key={`${file.name}-${idx}`} file={file} onRemove={() => removePendingFile(idx)} />
              ))}
            </div>
          )}
        </div>

        <select
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          className="w-full mb-3 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white text-sm outline-none"
          aria-label="Исполнитель"
        >
          <option value="">Исполнитель: не назначен</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name || member.username}{member.username ? ` (@${member.username})` : ""}
            </option>
          ))}
        </select>
        <input
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="Теги через запятую (необязательно)"
          className="w-full mb-3 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white text-sm outline-none focus:ring-2 ring-violet-500 dark:ring-cyan-400"
        />
        <div className="flex gap-2 mb-3">
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="flex-1 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white text-sm outline-none">
            <option value="low">Низкий приоритет</option>
            <option value="normal">Обычный</option>
            <option value="high">Высокий приоритет</option>
          </select>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="flex-1 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white text-sm outline-none" />
        </div>
        <label className="flex items-center gap-2 mb-4 text-sm text-neutral-600 dark:text-neutral-300">
          <input type="checkbox" checked={startInProgress} onChange={(e) => setStartInProgress(e.target.checked)} />
          Сразу взять в работу
        </label>
        <div className="flex gap-2 justify-end">
          <button onClick={requestClose} className="px-4 py-2 rounded-lg text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800">Отмена</button>
          <button onClick={submit} disabled={saving || !title.trim()} className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-700 dark:bg-cyan-500 dark:hover:bg-cyan-400 text-white disabled:opacity-50">
            {saving ? "…" : "Создать"}
          </button>
        </div>

        {/* FIX-UI3: подтверждение выхода — черновик не пропадает от случайного клика мимо окна */}
        {confirmExit && (
          <div className="absolute inset-0 z-10 rounded-2xl bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm flex items-center justify-center p-5">
            <div className="w-full max-w-xs rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-xl p-4 text-center">
              <p className="text-sm font-semibold text-neutral-900 dark:text-white mb-1">Закрыть создание задачи?</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">Введённые данные будут потеряны.</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmExit(false)} className="flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-700 dark:bg-cyan-500 dark:hover:bg-cyan-400 text-white">Продолжить</button>
                <button onClick={() => onClose(true)} className="flex-1 px-3 py-2 rounded-lg text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800">Закрыть</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// ФИКС: индикатор кулдауна — стрелка, как секундная на часах, делает полный оборот
// за время кулдауна (без числового отсчёта), а дуга по кругу показывает прогресс до активации кнопки.
function CooldownClock({ leftMs, totalMs }: { leftMs: number; totalMs: number }) {
  const progress = Math.min(1, Math.max(0, 1 - leftMs / totalMs));
  const angle = progress * 360;
  const rad = (angle * Math.PI) / 180;
  const r = 6.5;
  const c = 2 * Math.PI * r;
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" className="flex-shrink-0" aria-hidden="true">
      <circle cx={8} cy={8} r={r} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={1.5} />
      <circle
        cx={8} cy={8} r={r} fill="none" stroke="currentColor" strokeWidth={1.5}
        strokeDasharray={c} strokeDashoffset={c * (1 - progress)} strokeLinecap="round"
        transform="rotate(-90 8 8)"
      />
      <line
        x1={8} y1={8}
        x2={8 + 4.5 * Math.sin(rad)} y2={8 - 4.5 * Math.cos(rad)}
        stroke="currentColor" strokeWidth={1.5} strokeLinecap="round"
      />
      <circle cx={8} cy={8} r={1} fill="currentColor" />
    </svg>
  );
}
