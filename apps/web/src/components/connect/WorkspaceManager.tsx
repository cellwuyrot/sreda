"use client";

import { useState, type ReactNode } from "react";
// FIX-ICONS: фирменные SVG-иконки модулей вместо эмодзи (📰 ❓ 📚 📅 📁 ✅ 🎨)
import { NewsIcon, QuestionIcon, TaskIcon, PaletteIcon, UsersIcon } from "@/components/ui/ConnectIcons";
import { BookIcon, CalendarIcon, FolderIcon } from "@/components/ui/ConnectIconsExtra";
import InfoTooltip from "@/components/ui/InfoTooltip";
import { CHANNEL_MODULES, type ChannelModuleType } from "@/lib/channelModules";

interface WSChannel { id: string; name: string; type: string; hidden?: boolean }
interface WorkspaceManagerProps {
  groupId: string;
  channels: WSChannel[];
  canManage: boolean;
  onChanged: () => void;
}

/* Оформление модулей: пояснение, иконка и цвет. Сам список модулей (типы,
   подписи и имена по умолчанию) — общий, из lib/channelModules.ts: здесь была
   третья его копия, и она уже разошлась с панелями. Record по типу, а не
   массив: если в общий список добавят модуль и забудут оформление, TypeScript
   не даст собрать — вместо карточки без иконки в интерфейсе. */
const MODULE_VIEW: Record<ChannelModuleType, { desc: string; icon: ReactNode; tint: string }> = {
  NEWS:      { desc: "Лента анонсов и объявлений",  icon: <NewsIcon size={22} style={{ color: "inherit" }} />, tint: "#f59e0b" },
  QA:        { desc: "База вопросов с ответами",     icon: <QuestionIcon size={22} style={{ color: "inherit" }} />, tint: "#eab308" },
  WIKI:      { desc: "Статьи и глоссарий терминов", icon: <BookIcon size={22} style={{ color: "inherit" }} />, tint: "#10b981" },
  CALENDAR:  { desc: "События и расписание",         icon: <CalendarIcon size={22} style={{ color: "inherit" }} />, tint: "#3b82f6" },
  DOCS:      { desc: "Файлы и документы команды",   icon: <FolderIcon size={22} style={{ color: "inherit" }} />, tint: "#14b8a6" },
  TASKS:     { desc: "Канбан-доска задач",           icon: <TaskIcon size={22} style={{ color: "inherit" }} />, tint: "#6366f1" },
  CANVAS:    { desc: "Совместные холсты: до 5, все правят вместе", icon: <PaletteIcon size={22} style={{ color: "inherit" }} />, tint: "#a855f7" },
  // FIX-COMMUNITY: социальный раздел — активность участников и онбординг.
  COMMUNITY: { desc: "Активность участников и онбординг с выдачей роли", icon: <UsersIcon size={22} style={{ color: "inherit" }} />, tint: "#0ea5e9" },
};

const MODULES = CHANNEL_MODULES.map((m) => ({ ...m, ...MODULE_VIEW[m.type] }));

export default function WorkspaceManager({ groupId, channels, canManage, onChanged }: WorkspaceManagerProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  /* FIX-WSRENAME: какой блок переименовываем и что введено. */
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const addModule = async (m: typeof MODULES[number]) => {
    setBusy(m.type); setError("");
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: m.defaultName, type: m.type, groupId }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Ошибка"); }
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setBusy(null);
  };

  /* FIX-WSRENAME: названия блоков рабочей среды были неизменяемы: в этом списке
     имя рисовалось обычным текстом, рядом были только порядок, выключатель и
     удаление, а блок всю жизнь оставался с именем по умолчанию из
     lib/channelModules. Сервер переименование всегда разрешал (PUT
     /api/channels/[id] принимает name и сам проверяет права) — не хватало поля. */
  const renameChannel = async (id: string) => {
    const name = renameValue.trim();
    if (!name) return;
    setBusy(id); setError("");
    try {
      const res = await fetch(`/api/channels/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Ошибка"); }
      setRenameId(null);
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setBusy(null);
  };

  const toggleHidden = async (id: string, next: boolean) => {
    setBusy(id); setError("");
    try {
      const res = await fetch(`/api/channels/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hidden: next }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Ошибка"); }
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setBusy(null);
  };

  const removeChannel = async (id: string) => {
    setBusy(id); setError("");
    try {
      const res = await fetch(`/api/channels/${id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Ошибка"); }
      setConfirmId(null);
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setBusy(null);
  };

  // Ordered list of all module channels (segments) as shown in the right panel
  const moduleOrder = channels.filter((c) => MODULES.some((m) => m.type === c.type));

  const moveChannel = async (id: string, dir: "up" | "down") => {
    const idx = moduleOrder.findIndex((c) => c.id === id);
    const swap = idx + (dir === "up" ? -1 : 1);
    if (idx < 0 || swap < 0 || swap >= moduleOrder.length) return;
    const reordered = [...moduleOrder];
    [reordered[idx], reordered[swap]] = [reordered[swap], reordered[idx]];
    setBusy(id); setError("");
    try {
      await Promise.all(
        reordered.map((c, i) =>
          fetch(`/api/channels/${c.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sortOrder: i }),
          }),
        ),
      );
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setBusy(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs text-neutral-400 uppercase tracking-wider font-semibold">
          Рабочая среда
          <InfoTooltip text="Подключите нужные разделы — они появятся у группы справа, отдельной колонкой вспомогательных модулей." className="ml-1" />
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="space-y-2.5 max-h-[26rem] overflow-y-auto -mx-1 px-1 pb-1">
        {MODULES.map((m) => {
          const existing = channels.filter((c) => c.type === m.type);
          const has = existing.length > 0;
          return (
            <div
              key={m.type}
              className={`rounded-xl border p-3.5 transition-colors ${has ? "border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-neutral-800/40" : "border-dashed border-neutral-300 dark:border-white/10"}`}
            >
              <div className="flex items-center gap-3">
                <span
                  className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: m.tint + "1f", color: m.tint }}
                >
                  {m.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-neutral-900 dark:text-white">{m.label}</span>
                    {has && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-600 dark:text-green-400">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        подключено{existing.length > 1 ? ` · ${existing.length}` : ""}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-snug mt-0.5">{m.desc}</p>
                </div>
                {canManage && (
                  <button
                    onClick={() => addModule(m)}
                    disabled={busy === m.type}
                    className={`flex-shrink-0 px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-50 ${has ? "bg-neutral-100 dark:bg-neutral-700/60 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700" : "bg-violet-600 hover:bg-violet-700 dark:bg-cyan-500 dark:hover:bg-cyan-400 text-white"}`}
                  >
                    {busy === m.type ? "…" : has ? "Добавить ещё" : "Добавить"}
                  </button>
                )}
                {!canManage && !has && (
                  <span className="flex-shrink-0 text-[11px] text-neutral-400 italic">Не подключено</span>
                )}
              </div>

              {has && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {existing.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 text-xs bg-white dark:bg-neutral-800 rounded-lg pl-3 pr-2 py-1.5 border border-neutral-200 dark:border-white/5">
                      {renameId === c.id ? (
                        <form
                          onSubmit={(e) => { e.preventDefault(); renameChannel(c.id); }}
                          className="flex items-center gap-1"
                        >
                          <input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Escape") setRenameId(null); }}
                            autoFocus
                            maxLength={80}
                            aria-label="Название блока"
                            className="w-[10rem] bg-transparent border-b border-violet-500 dark:border-cyan-400 text-xs outline-none text-neutral-800 dark:text-neutral-100"
                          />
                          <button type="submit" disabled={busy === c.id || !renameValue.trim()} className="text-[11px] px-2 py-0.5 rounded bg-violet-600 dark:bg-cyan-500 text-white disabled:opacity-50">Готово</button>
                          <button type="button" onClick={() => setRenameId(null)} className="text-[11px] px-2 py-0.5 rounded bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300">Отмена</button>
                        </form>
                      ) : (
                        <span className="text-neutral-700 dark:text-neutral-200 max-w-[12rem] truncate">{c.name}</span>
                      )}
                      {canManage && (confirmId === c.id ? (
                        <span className="flex items-center gap-1">
                          <button onClick={() => removeChannel(c.id)} disabled={busy === c.id} className="text-[11px] px-2 py-0.5 rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-50">Удалить навсегда</button>
                          <button onClick={() => setConfirmId(null)} className="text-[11px] px-2 py-0.5 rounded bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300">Отмена</button>
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <span className="flex items-center">
                            <button
                              type="button"
                              onClick={() => moveChannel(c.id, "up")}
                              disabled={busy === c.id || moduleOrder.findIndex((x) => x.id === c.id) <= 0}
                              title="Поднять выше"
                              className="px-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 disabled:opacity-30 disabled:cursor-default"
                            >▲</button>
                            <button
                              type="button"
                              onClick={() => moveChannel(c.id, "down")}
                              disabled={busy === c.id || moduleOrder.findIndex((x) => x.id === c.id) >= moduleOrder.length - 1}
                              title="Опустить ниже"
                              className="px-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 disabled:opacity-30 disabled:cursor-default"
                            >▼</button>
                          </span>
                          <button
                            type="button"
                            onClick={() => { setRenameId(c.id); setRenameValue(c.name); }}
                            disabled={busy === c.id}
                            title="Переименовать блок"
                            aria-label="Переименовать блок"
                            className="text-neutral-400 hover:text-violet-600 dark:hover:text-cyan-400 transition-colors disabled:opacity-40"
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.5 5.5l3 3M4 20h4L18 10l-4-4L4 16v4z" /></svg>
                          </button>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={!c.hidden}
                            disabled={busy === c.id}
                            onClick={() => toggleHidden(c.id, !c.hidden)}
                            title={c.hidden ? "Включить раздел" : "Отключить раздел"}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${c.hidden ? "bg-neutral-300 dark:bg-neutral-600" : "bg-green-500"}`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${c.hidden ? "translate-x-0.5" : "translate-x-4"}`} />
                          </button>
                          {c.hidden && (
                            <button onClick={() => setConfirmId(c.id)} className="text-neutral-400 hover:text-red-500 transition-colors" aria-label="Удалить раздел навсегда" title="Удалить навсегда">
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
