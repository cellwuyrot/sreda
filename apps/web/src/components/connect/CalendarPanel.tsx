"use client";

import { useState, useEffect, useCallback } from "react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { CalendarIcon, EditIcon, TrashIcon } from "@/components/ui/ConnectIconsExtra";
import { BellIcon } from "@/components/ui/ConnectIcons"; // FIX-CAL-REMIND: подписка на событие
import { renderContent } from "./messageFormat"; // FIX-LINKS: кликабельные ссылки в описаниях событий

type EventAuthor = { id: string; name: string; username?: string };
type CalEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  color: string;
  allDay: boolean;
  start: string;
  end: string | null;
  author: EventAuthor;
};

interface CalendarPanelProps {
  channelId: string;
  channelName: string;
}

const MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const WEEKDAYS = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
const COLORS = ["#3b82f6","#ef4444","#22c55e","#f59e0b","#8b5cf6","#ec4899","#14b8a6"];

function ymd(d: Date) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function CalendarPanel({ channelId, channelName }: CalendarPanelProps) {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(() => new Date());
  const [view, setView] = useState<"month" | "list">("month");
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [editing, setEditing] = useState<CalEvent | null>(null);
  const [showForm, setShowForm] = useState(false);
  // FIX-CAL-REMIND: id событий, на которые подписан текущий пользователь.
  const [subscribedIds, setSubscribedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const first = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
      const last = new Date(cursor.getFullYear(), cursor.getMonth() + 2, 0, 23, 59, 59);
      const res = await fetch(`/api/calendar?channelId=${channelId}&from=${first.toISOString()}&to=${last.toISOString()}`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
        setCanEdit(!!data.canEdit);
        setCurrentUserId(data.currentUserId || "");
        setSubscribedIds(new Set<string>(Array.isArray(data.subscribedIds) ? data.subscribedIds : []));
      }
    } finally {
      setLoading(false);
    }
  }, [channelId, cursor]);

  useEffect(() => { load(); }, [load]);

  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const startWeekday = (monthStart.getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);

  const eventsForDay = (day: Date) => events.filter((e) => sameDay(new Date(e.start), day)).sort((a, b) => +new Date(a.start) - +new Date(b.start));
  const sortedUpcoming = [...events].sort((a, b) => +new Date(a.start) - +new Date(b.start));

  const openCreate = (day?: Date) => {
    setEditing(null);
    setSelectedDay(day || new Date());
    setShowForm(true);
  };
  const openEdit = (ev: CalEvent) => { setEditing(ev); setShowForm(true); };

  const onDelete = async (ev: CalEvent) => {
    if (!(await confirmDialog({ message: "Удалить событие «" + ev.title + "»?", confirmText: "Удалить", danger: true }))) return;
    const res = await fetch("/api/calendar/" + ev.id, { method: "DELETE" });
    if (res.ok) setEvents((prev) => prev.filter((x) => x.id !== ev.id));
  };

  // FIX-CAL-REMIND: подписка/отписка на напоминание о событии (уведомление
  // придёт за ~15 минут до начала — в колокольчик и раздел уведомлений).
  const toggleSubscribe = async (ev: CalEvent) => {
    const res = await fetch("/api/calendar/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: ev.id }),
    });
    if (!res.ok) return;
    const data = await res.json().catch(() => null);
    setSubscribedIds((prev) => {
      const next = new Set(prev);
      if (data?.subscribed) next.add(ev.id); else next.delete(ev.id);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary,#0f1117)] text-[var(--text-primary,#e6e6e6)]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border,#222)]">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold flex items-center gap-2"><CalendarIcon size={20} /> {channelName}</span>
          <div className="flex items-center gap-1 rounded-lg bg-[var(--bg-secondary,#1a1d27)] p-0.5">
            <button onClick={() => setView("month")} className={"px-2.5 py-1 text-xs rounded-md " + (view === "month" ? "bg-[var(--accent,#3b82f6)] text-white" : "text-[var(--text-muted,#9aa0ab)]")}>Месяц</button>
            <button onClick={() => setView("list")} className={"px-2.5 py-1 text-xs rounded-md " + (view === "list" ? "bg-[var(--accent,#3b82f6)] text-white" : "text-[var(--text-muted,#9aa0ab)]")}>Список</button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {view === "month" && (
            <div className="flex items-center gap-1">
              <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="px-2 py-1 rounded hover:bg-[var(--bg-secondary,#1a1d27)]">‹</button>
              <span className="text-sm font-medium min-w-[140px] text-center">{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</span>
              <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="px-2 py-1 rounded hover:bg-[var(--bg-secondary,#1a1d27)]">›</button>
              <button onClick={() => setCursor(new Date())} className="ml-1 px-2 py-1 text-xs rounded hover:bg-[var(--bg-secondary,#1a1d27)]">Сегодня</button>
            </div>
          )}
          {canEdit && (
            <button onClick={() => openCreate()} className="px-3 py-1.5 text-sm rounded-lg bg-[var(--accent,#3b82f6)] text-white hover:opacity-90">+ Событие</button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-[var(--text-muted,#9aa0ab)]">Загрузка…</div>
      ) : view === "month" ? (
        <div className="flex-1 overflow-auto p-3">
          <div className="grid grid-cols-7 gap-px mb-1">
            {WEEKDAYS.map((w) => (<div key={w} className="text-center text-xs font-medium text-[var(--text-muted,#9aa0ab)] py-1">{w}</div>))}
          </div>
          <div className="grid grid-cols-7 gap-px bg-[var(--border,#222)] rounded-lg overflow-hidden">
            {cells.map((day, i) => {
              if (!day) return <div key={i} className="bg-[var(--bg-primary,#0f1117)] min-h-[90px]" />;
              const dayEvents = eventsForDay(day);
              const isToday = sameDay(day, new Date());
              return (
                <div key={i} onClick={() => canEdit && openCreate(day)} className={"bg-[var(--bg-primary,#0f1117)] min-h-[90px] p-1.5 " + (canEdit ? "cursor-pointer hover:bg-[var(--bg-secondary,#1a1d27)]" : "")}>
                  <div className={"text-xs mb-1 inline-flex items-center justify-center w-6 h-6 rounded-full " + (isToday ? "bg-[var(--accent,#3b82f6)] text-white font-semibold" : "text-[var(--text-muted,#9aa0ab)]")}>{day.getDate()}</div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <button key={ev.id} onClick={(e) => { e.stopPropagation(); openEdit(ev); }} className="w-full text-left text-[11px] px-1.5 py-0.5 rounded truncate text-white" style={ { backgroundColor: ev.color } } title={ev.title}>
                        {ev.allDay ? "" : new Date(ev.start).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) + " "}{ev.title}
                      </button>
                    ))}
                    {dayEvents.length > 3 && (<div className="text-[10px] text-[var(--text-muted,#9aa0ab)] pl-1">+{dayEvents.length - 3} ещё</div>)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4 space-y-2">
          {sortedUpcoming.length === 0 ? (
            <div className="text-center text-[var(--text-muted,#9aa0ab)] mt-12">
              <div className="mb-2"><CalendarIcon size={36} /></div>
              <p>Событий пока нет</p>
              {canEdit && <button onClick={() => openCreate()} className="mt-3 px-4 py-2 rounded-lg bg-[var(--accent,#3b82f6)] text-white">Создать первое событие</button>}
            </div>
          ) : sortedUpcoming.map((ev) => (
            <div key={ev.id} className="flex items-start gap-3 p-3 rounded-lg bg-[var(--bg-secondary,#1a1d27)] hover:bg-[var(--bg-tertiary,#222633)] group">
              <div className="w-1 self-stretch rounded-full" style={ { backgroundColor: ev.color } } />
              <div className="flex-1 min-w-0">
                <div className="font-medium">{ev.title}</div>
                <div className="text-xs text-[var(--text-muted,#9aa0ab)] mt-0.5">
                  {new Date(ev.start).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: ev.allDay ? undefined : "2-digit", minute: ev.allDay ? undefined : "2-digit" })}
                  {ev.allDay && " · весь день"}
                  {ev.location && " · " + ev.location}
                </div>
                {ev.description && <div className="text-sm mt-1 text-[var(--text-secondary,#c4c8d0)] whitespace-pre-wrap">{renderContent(ev.description)}</div>}
              </div>
              {/* FIX-CAL-REMIND: колокольчик подписки — виден всем участникам,
                  только для будущих событий */}
              {new Date(ev.start) > new Date() && (
                <button
                  onClick={() => toggleSubscribe(ev)}
                  className={"p-1 rounded self-center hover:bg-[var(--bg-primary,#0f1117)] " + (subscribedIds.has(ev.id) ? "text-amber-400" : "text-[var(--text-muted,#9aa0ab)]")}
                  title={subscribedIds.has(ev.id) ? "Напоминание включено — нажмите, чтобы отписаться" : "Напомнить за 15 минут до начала"}
                  aria-pressed={subscribedIds.has(ev.id)}
                  aria-label={subscribedIds.has(ev.id) ? "Отписаться от напоминания" : "Подписаться на напоминание"}
                >
                  <BellIcon size={16} tone={subscribedIds.has(ev.id) ? "active" : "muted"} style={{ color: "inherit" }} />
                </button>
              )}
              {(canEdit || ev.author.id === currentUserId) && (
                <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                  <button onClick={() => openEdit(ev)} className="p-1 text-xs rounded hover:bg-[var(--bg-primary,#0f1117)]" title="Изменить"><EditIcon size={14} /></button>
                  <button onClick={() => onDelete(ev)} className="p-1 text-xs rounded hover:bg-[var(--bg-primary,#0f1117)]" title="Удалить"><TrashIcon size={14} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <EventForm
          channelId={channelId}
          editing={editing}
          defaultDay={selectedDay}
          onClose={() => setShowForm(false)}
          onSaved={(ev, isNew) => {
            setEvents((prev) => isNew ? [...prev, ev] : prev.map((x) => x.id === ev.id ? ev : x));
            setShowForm(false);
          }}
        />
      )}
    </div>
  );
}

function EventForm({ channelId, editing, defaultDay, onClose, onSaved }: {
  channelId: string;
  editing: CalEvent | null;
  defaultDay: Date | null;
  onClose: () => void;
  onSaved: (ev: CalEvent, isNew: boolean) => void;
}) {
  const base = editing ? new Date(editing.start) : (defaultDay || new Date());
  const [title, setTitle] = useState(editing?.title || "");
  const [description, setDescription] = useState(editing?.description || "");
  const [location, setLocation] = useState(editing?.location || "");
  const [color, setColor] = useState(editing?.color || COLORS[0]);
  const [allDay, setAllDay] = useState(editing?.allDay || false);
  const [date, setDate] = useState(ymd(base));
  const [time, setTime] = useState(editing && !editing.allDay ? new Date(editing.start).toTimeString().slice(0, 5) : "10:00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!title.trim()) { setError("Введите название"); return; }
    setSaving(true);
    setError("");
    const start = allDay ? new Date(date + "T00:00:00") : new Date(date + "T" + time + ":00");
    const payload = { channelId, title, description, location, color, allDay, start: start.toISOString() };
    try {
      const res = editing
        ? await fetch("/api/calendar/" + editing.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch("/api/calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (res.ok) {
        const data = await res.json();
        onSaved(data.event, !editing);
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Ошибка сохранения");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-[var(--bg-secondary,#1a1d27)] p-5 m-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">{editing ? "Изменить событие" : "Новое событие"}</h3>
        <div className="space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название события" className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary,#0f1117)] border border-[var(--border,#222)] outline-none focus:border-[var(--accent,#3b82f6)]" autoFocus />
          <div className="flex gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-primary,#0f1117)] border border-[var(--border,#222)] outline-none" />
            {!allDay && <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="px-3 py-2 rounded-lg bg-[var(--bg-primary,#0f1117)] border border-[var(--border,#222)] outline-none" />}
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> Весь день
          </label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Место (необязательно)" className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary,#0f1117)] border border-[var(--border,#222)] outline-none" />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Описание (необязательно)" rows={3} className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary,#0f1117)] border border-[var(--border,#222)] outline-none resize-none" />
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--text-muted,#9aa0ab)]">Цвет:</span>
            {COLORS.map((c) => (
              <button key={c} onClick={() => setColor(c)} className={"w-6 h-6 rounded-full " + (color === c ? "ring-2 ring-offset-2 ring-offset-[var(--bg-secondary,#1a1d27)] ring-white" : "")} style={ { backgroundColor: c } } />
            ))}
          </div>
          {error && <div className="text-sm text-red-400">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg hover:bg-[var(--bg-primary,#0f1117)]">Отмена</button>
          <button onClick={submit} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-[var(--accent,#3b82f6)] text-white disabled:opacity-50">{saving ? "Сохранение…" : "Сохранить"}</button>
        </div>
      </div>
    </div>
  );
}
