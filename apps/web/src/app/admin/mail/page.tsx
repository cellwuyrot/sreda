"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAdminBackHref, useAdminBackLabel } from "@/components/admin/useAdminBackHref";
import MailComposer from "@/components/admin/mail/MailComposer";

/**
 * PROJECT-MAIL — раздел «Тема Email и обработка данных» админ-панели.
 *
 * Функции:
 *  1. Полное открытие письма — клик на строке разворачивает панель с bodyHtml.
 *  2. Поиск по текущему ящику — по теме, адресу отправителя/получателя.
 *  3. Чёрный список адресов — вкладка «ЧС», CRUD через /api/admin/mail/blacklist.
 *  4. Режим папок — кнопка «Настройка папок», CRUD через /api/admin/mail/folders.
 *     Папка = сохранённый фильтр по направлению/адресу/теме.
 */

// ─── types ───────────────────────────────────────────────────────────────────

type Direction = "incoming" | "outgoing";
type MainTab = Direction | "archive";
type SideTab = "mail" | "blacklist" | "folders";

interface Mailbox {
  localPart: string;
  address: string;
  label: string;
  purpose: string;
  active: boolean;
  incoming: number;
  outgoing: number;
}

interface MailRow {
  id: string;
  direction: Direction;
  fromAddr: string;
  toAddr: string;
  subject: string;
  preview: string;
  archived: boolean;
  sentAt: string;
}

interface MailDetail {
  id: string;
  fromAddr: string;
  fromName?: string;
  toAddr: string;
  ccAddr?: string;
  subject: string;
  bodyHtml?: string;
  sentAt: string;
  attachments?: { id: string; name: string; mime: string; size: number; url: string }[];
}

interface BlacklistEntry {
  id: string;
  address: string;
  note: string;
  addedAt: string;
}

interface MailFolder {
  id: string;
  name: string;
  color: string;
  icon: string;
  filter: {
    direction?: string;
    fromContains?: string;
    toContains?: string;
    subjectContains?: string;
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function Icon({ path }: { path: React.ReactNode }) {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8}
      viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      {path}
    </svg>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function matchesSearch(row: MailRow, q: string): boolean {
  if (!q) return true;
  const lq = q.toLowerCase();
  return (
    row.subject.toLowerCase().includes(lq) ||
    row.fromAddr.toLowerCase().includes(lq) ||
    row.toAddr.toLowerCase().includes(lq) ||
    row.preview.toLowerCase().includes(lq)
  );
}

function matchesFolder(row: MailRow, folder: MailFolder | null): boolean {
  if (!folder) return true;
  const f = folder.filter;
  if (f.direction && row.direction !== f.direction) return false;
  if (f.fromContains && !row.fromAddr.toLowerCase().includes(f.fromContains.toLowerCase())) return false;
  if (f.toContains && !row.toAddr.toLowerCase().includes(f.toContains.toLowerCase())) return false;
  if (f.subjectContains && !row.subject.toLowerCase().includes(f.subjectContains.toLowerCase())) return false;
  return true;
}

const FOLDER_COLORS = ["#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#6366f1"];
const FOLDER_ICONS = ["📁", "⭐", "📌", "🔔", "📨", "📤", "💼", "💡"];

// ─── sub-components ───────────────────────────────────────────────────────────

/** Полное просмотр письма — инлайн-панель под строкой */
function MailDetailPanel({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<MailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/admin/mail/message/${messageId}/view`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => setDetail(data.message))
      .catch(() => setError("Не удалось загрузить письмо"))
      .finally(() => setLoading(false));
  }, [messageId]);

  return (
    <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50/30 p-4 dark:border-cyan-500/20 dark:bg-cyan-500/5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-violet-700 dark:text-cyan-300">Полное письмо</span>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-white"
          aria-label="Закрыть"
        >
          <Icon path={<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>} />
        </button>
      </div>

      {loading && <p className="text-sm text-neutral-400">Загрузка…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {detail && (
        <div className="space-y-3">
          {/* Шапка письма */}
          <div className="grid gap-1 rounded-lg bg-white/60 px-3 py-2 text-xs dark:bg-white/5">
            <div className="flex gap-2">
              <span className="w-16 flex-shrink-0 font-medium text-neutral-500">От:</span>
              <span className="text-neutral-800 dark:text-gray-200">
                {detail.fromName ? `${detail.fromName} \u003c${detail.fromAddr}\u003e` : detail.fromAddr}
              </span>
            </div>
            <div className="flex gap-2">
              <span className="w-16 flex-shrink-0 font-medium text-neutral-500">Кому:</span>
              <span className="text-neutral-800 dark:text-gray-200">{detail.toAddr}</span>
            </div>
            {detail.ccAddr && (
              <div className="flex gap-2">
                <span className="w-16 flex-shrink-0 font-medium text-neutral-500">Cc:</span>
                <span className="text-neutral-800 dark:text-gray-200">{detail.ccAddr}</span>
              </div>
            )}
            <div className="flex gap-2">
              <span className="w-16 flex-shrink-0 font-medium text-neutral-500">Тема:</span>
              <span className="font-semibold text-neutral-900 dark:text-white">{detail.subject}</span>
            </div>
            <div className="flex gap-2">
              <span className="w-16 flex-shrink-0 font-medium text-neutral-500">Дата:</span>
              <span className="text-neutral-600 dark:text-gray-400">{formatDate(String(detail.sentAt))}</span>
            </div>
          </div>

          {/* Тело */}
          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-white/10">
            {detail.bodyHtml ? (
              <iframe
                srcDoc={detail.bodyHtml}
                sandbox="allow-same-origin"
                className="h-[420px] w-full"
                title="Тело письма"
              />
            ) : (
              <p className="px-4 py-6 text-sm text-neutral-400">Тело письма недоступно</p>
            )}
          </div>

          {/* Вложения */}
          {detail.attachments && detail.attachments.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-neutral-500">Вложения:</p>
              {detail.attachments.map((att) => (
                <a
                  key={att.id}
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-violet-600 hover:bg-violet-50 dark:border-white/10 dark:text-cyan-400 dark:hover:bg-cyan-500/5"
                >
                  <Icon path={<><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></>} />
                  {att.name}
                  <span className="ml-auto text-neutral-400">{Math.round(att.size / 1024)} КБ</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Чёрный список */
function BlacklistPanel() {
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/mail/blacklist")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEntries(d?.entries ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const addr = input.trim().toLowerCase();
    if (!addr) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/mail/blacklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr, note }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Ошибка"); return; }
      setInput(""); setNote("");
      load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/admin/mail/blacklist?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500 dark:text-gray-400">
        Адреса из этого списка можно использовать для автоматической фильтрации
        нежелательной почты. Укажите email или домен (@example.com).
      </p>

      {/* Форма добавления */}
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-white/10 dark:bg-white/5">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="user@example.com или @domain.com"
            className="flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-violet-400 focus:outline-none dark:border-white/10 dark:bg-neutral-800 dark:text-white dark:focus:border-cyan-500"
            onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
          />
          <button
            onClick={add}
            disabled={saving || !input.trim()}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50 dark:bg-cyan-600 dark:hover:bg-cyan-500"
          >
            {saving ? "…" : "Добавить"}
          </button>
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Примечание (необязательно)"
          className="mt-2 w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-violet-400 focus:outline-none dark:border-white/10 dark:bg-neutral-800 dark:text-white dark:focus:border-cyan-500"
        />
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>

      {/* Список */}
      {loading && <p className="text-sm text-neutral-400">Загрузка…</p>}
      {!loading && entries.length === 0 && (
        <p className="rounded-xl border border-dashed border-neutral-200 px-4 py-6 text-center text-sm text-neutral-400 dark:border-white/10">
          Чёрный список пуст
        </p>
      )}
      <div className="space-y-2">
        {entries.map((e) => (
          <div key={e.id} className="flex items-start gap-3 rounded-xl border border-neutral-200 px-3.5 py-2.5 dark:border-white/10">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-neutral-900 dark:text-white">{e.address}</p>
              {e.note && <p className="text-xs text-neutral-500 dark:text-gray-400">{e.note}</p>}
              <p className="text-[11px] text-neutral-400">Добавлен {formatDate(e.addedAt)}</p>
            </div>
            <button
              onClick={() => remove(e.id)}
              className="mt-0.5 flex-shrink-0 rounded-lg p-1 text-neutral-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
              aria-label="Удалить"
            >
              <Icon path={<><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Режим настройки папок */
function FoldersPanel({ onFolderSelect }: { onFolderSelect: (f: MailFolder | null) => void }) {
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MailFolder | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", color: FOLDER_COLORS[0], icon: FOLDER_ICONS[0], direction: "", fromContains: "", toContains: "", subjectContains: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/mail/folders")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setFolders(d?.folders ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => setForm({ name: "", color: FOLDER_COLORS[0], icon: FOLDER_ICONS[0], direction: "", fromContains: "", toContains: "", subjectContains: "" });

  const startCreate = () => { setEditing(null); resetForm(); setCreating(true); };
  const startEdit = (f: MailFolder) => {
    setCreating(false);
    setEditing(f);
    setForm({ name: f.name, color: f.color, icon: f.icon, direction: f.filter.direction ?? "", fromContains: f.filter.fromContains ?? "", toContains: f.filter.toContains ?? "", subjectContains: f.filter.subjectContains ?? "" });
  };

  const save = async () => {
    setSaving(true); setError(null);
    const body = { name: form.name, color: form.color, icon: form.icon, filter: { direction: form.direction, fromContains: form.fromContains, toContains: form.toContains, subjectContains: form.subjectContains } };
    try {
      const res = editing
        ? await fetch("/api/admin/mail/folders", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editing.id, ...body }) })
        : await fetch("/api/admin/mail/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Ошибка"); return; }
      setCreating(false); setEditing(null); resetForm(); load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/admin/mail/folders?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (activeFolder === id) { setActiveFolder(null); onFolderSelect(null); }
    load();
  };

  const selectFolder = (f: MailFolder) => {
    if (activeFolder === f.id) { setActiveFolder(null); onFolderSelect(null); }
    else { setActiveFolder(f.id); onFolderSelect(f); }
  };

  const FolderForm = (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-white/10 dark:bg-white/5 space-y-2">
      <p className="text-xs font-semibold text-neutral-700 dark:text-gray-300">{editing ? "Редактирование папки" : "Новая папка"}</p>
      <div className="flex gap-2">
        {/* Иконка */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-neutral-400">Икона</span>
          <div className="flex flex-wrap gap-1">
            {FOLDER_ICONS.map((ic) => (
              <button key={ic} onClick={() => setForm((p) => ({ ...p, icon: ic }))}
                className={`rounded px-1.5 py-0.5 text-base transition-all ${form.icon === ic ? "ring-2 ring-violet-400 dark:ring-cyan-400" : "opacity-60 hover:opacity-100"}`}>
                {ic}
              </button>
            ))}
          </div>
        </div>
        {/* Цвет */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-neutral-400">Цвет</span>
          <div className="flex flex-wrap gap-1">
            {FOLDER_COLORS.map((c) => (
              <button key={c} onClick={() => setForm((p) => ({ ...p, color: c }))}
                className="h-5 w-5 rounded-full transition-all"
                style={{ background: c, outline: form.color === c ? `2px solid ${c}` : "none", outlineOffset: 2 }} />
            ))}
          </div>
        </div>
      </div>
      <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
        placeholder="Название папки"
        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm focus:border-violet-400 focus:outline-none dark:border-white/10 dark:bg-neutral-800 dark:text-white dark:focus:border-cyan-500" />
      <p className="text-[11px] font-medium text-neutral-500">Фильтр (оставьте пустыми, чтобы показывать всё):</p>
      <select value={form.direction} onChange={(e) => setForm((p) => ({ ...p, direction: e.target.value }))}
        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm focus:outline-none dark:border-white/10 dark:bg-neutral-800 dark:text-white">
        <option value="">Любое направление</option>
        <option value="incoming">Входящие</option>
        <option value="outgoing">Исходящие</option>
      </select>
      <input value={form.fromContains} onChange={(e) => setForm((p) => ({ ...p, fromContains: e.target.value }))}
        placeholder="Отправитель содержит (например: support@)"
        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm focus:border-violet-400 focus:outline-none dark:border-white/10 dark:bg-neutral-800 dark:text-white dark:focus:border-cyan-500" />
      <input value={form.toContains} onChange={(e) => setForm((p) => ({ ...p, toContains: e.target.value }))}
        placeholder="Получатель содержит"
        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm focus:border-violet-400 focus:outline-none dark:border-white/10 dark:bg-neutral-800 dark:text-white dark:focus:border-cyan-500" />
      <input value={form.subjectContains} onChange={(e) => setForm((p) => ({ ...p, subjectContains: e.target.value }))}
        placeholder="Тема содержит"
        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm focus:border-violet-400 focus:outline-none dark:border-white/10 dark:bg-neutral-800 dark:text-white dark:focus:border-cyan-500" />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button onClick={() => { setCreating(false); setEditing(null); resetForm(); }}
          className="rounded-lg px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-white">
          Отмена
        </button>
        <button onClick={save} disabled={saving || !form.name.trim()}
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50 dark:bg-cyan-600 dark:hover:bg-cyan-500">
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-500 dark:text-gray-400">
          Папка — это сохранённый фильтр. Нажмите на папку,
          чтобы применить её фильтр к текущему ящику.
        </p>
        <button onClick={startCreate}
          className="flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-violet-700 dark:bg-cyan-600 dark:hover:bg-cyan-500">
          <Icon path={<><path d="M12 5v14" /><path d="M5 12h14" /></>} />
          Новая
        </button>
      </div>

      {creating && FolderForm}

      {loading && <p className="text-sm text-neutral-400">Загрузка…</p>}
      {!loading && folders.length === 0 && !creating && (
        <p className="rounded-xl border border-dashed border-neutral-200 px-4 py-6 text-center text-sm text-neutral-400 dark:border-white/10">
          Папок пока нет
        </p>
      )}
      <div className="space-y-2">
        {folders.map((f) => (
          <div key={f.id}>
            <div
              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-all ${
                activeFolder === f.id
                  ? "border-violet-300 bg-violet-50 dark:border-cyan-500/40 dark:bg-cyan-500/10"
                  : "border-neutral-200 hover:border-neutral-300 dark:border-white/10 dark:hover:border-white/20"
              }`}
              onClick={() => selectFolder(f)}
            >
              <span className="text-lg">{f.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-neutral-900 dark:text-white" style={{ color: f.color }}>{f.name}</p>
                <p className="truncate text-[11px] text-neutral-400">
                  {[f.filter.direction && (f.filter.direction === "incoming" ? "входящие" : "исходящие"), f.filter.fromContains && `от: ${f.filter.fromContains}`, f.filter.subjectContains && `тема: ${f.filter.subjectContains}`].filter(Boolean).join(" · ") || "все письма"}
                </p>
              </div>
              <div className="flex gap-1">
                <button onClick={(ev) => { ev.stopPropagation(); startEdit(f); }}
                  className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-white/10 dark:hover:text-white">
                  <Icon path={<><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></>} />
                </button>
                <button onClick={(ev) => { ev.stopPropagation(); void remove(f.id); }}
                  className="rounded-lg p-1 text-neutral-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10">
                  <Icon path={<><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>} />
                </button>
              </div>
            </div>
            {editing?.id === f.id && <div className="mt-1 pl-2">{FolderForm}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function AdminMailPage() {
  const backHref = useAdminBackHref();
  const backLabel = useAdminBackLabel();
  const { data: session, status } = useSession();
  const router = useRouter();

  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<MainTab>("incoming");
  const [sideTab, setSideTab] = useState<SideTab>("mail");
  const [rows, setRows] = useState<MailRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [templates, setTemplates] = useState<Array<{ key: string; name: string; subject: string; format: string; body: string }>>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeFolder, setActiveFolder] = useState<MailFolder | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") router.push("/connect");
  }, [session, status, router]);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/mail", { cache: "no-store" }),
      fetch("/api/admin/mail/templates", { cache: "no-store" }),
    ])
      .then(async ([mailRes, templateRes]) => [await (mailRes.ok ? mailRes.json() : null), await (templateRes.ok ? templateRes.json() : null)])
      .then(([data, templateData]) => {
        const list: Mailbox[] = data?.mailboxes ?? [];
        setMailboxes(list);
        setTemplates(templateData?.templates ?? []);
        if (list.length && !selected) setSelected(list[0].localPart);
      })
      .catch(() => {})
      .finally(() => setLoadingList(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshMailboxSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/mail", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setMailboxes(data?.mailboxes ?? []);
    } catch {}
  }, []);

  const syncIncoming = useCallback(async (localPart: string) => {
    setSyncing(true);
    try {
      const res = await fetch("/api/mail/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: localPart }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const details = Array.isArray(data?.errors) ? data.errors.map((e: { error?: string }) => e?.error).filter(Boolean).join("; ") : "";
        setNote(details ? `Не удалось проверить почту: ${details}` : "Не удалось проверить входящие письма");
        return false;
      }
      if (Array.isArray(data?.errors) && data.errors.length) {
        const details = data.errors.map((e: { error?: string }) => e?.error).filter(Boolean).join("; ");
        setNote(details ? `Почта проверена с ошибкой: ${details}` : "Почта проверена с частичной ошибкой");
      } else if (Number(data?.stored || 0) > 0) {
        setNote(`Получено новых писем: ${data.stored}`);
      } else {
        setNote("Входящие проверены: новых писем нет");
      }
      await refreshMailboxSummary();
      return true;
    } catch {
      setNote("Не удалось проверить входящие письма");
      return false;
    } finally {
      setSyncing(false);
    }
  }, [refreshMailboxSummary]);

  const loadRows = useCallback(async (localPart: string, which: MainTab, sync = which === "incoming") => {
    setLoadingRows(true);
    if (sync) await syncIncoming(localPart);
    const params = new URLSearchParams();
    if (which === "archive") params.set("archived", "1");
    else params.set("direction", which);
    try {
      const res = await fetch(`/api/admin/mail/${encodeURIComponent(localPart)}?${params.toString()}`, { cache: "no-store" });
      const data = res.ok ? await res.json() : null;
      setRows(data?.messages ?? []);
      setExpandedId(null);
    } catch {
      setRows([]);
    } finally {
      setLoadingRows(false);
    }
  }, [syncIncoming]);

  useEffect(() => {
    if (!selected) return;
    void loadRows(selected, tab);
    if (tab !== "incoming") return;
    const timer = window.setInterval(() => { void loadRows(selected, "incoming"); }, 30000);
    return () => window.clearInterval(timer);
  }, [selected, tab, loadRows]);

  // Сбрасываем поиск и развёрнутое письмо при смене ящика / вкладки
  useEffect(() => { setSearch(""); setExpandedId(null); }, [selected, tab]);

  const archive = useCallback(
    async (id: string, archived: boolean) => {
      if (!selected) return;
      setRows((prev) => prev.filter((m) => m.id !== id));
      if (expandedId === id) setExpandedId(null);
      try {
        const res = await fetch(`/api/admin/mail/${encodeURIComponent(selected)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, archived }),
        });
        if (!res.ok) throw new Error();
      } catch {
        setNote("Не удалось обновить письмо");
        loadRows(selected, tab);
      }
    },
    [selected, tab, expandedId, loadRows],
  );

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-violet-500" />
      </div>
    );
  }
  if (session?.user?.role !== "ADMIN") return null;

  const activeBox = mailboxes.find((m) => m.localPart === selected) ?? null;

  const MAIN_TABS: { id: MainTab; label: string }[] = [
    { id: "incoming", label: "Входящие" },
    { id: "outgoing", label: "Исходящие" },
    { id: "archive", label: "Архив" },
  ];

  const SIDE_TABS: { id: SideTab; label: string; icon: React.ReactNode }[] = [
    { id: "mail", label: "Почта", icon: <Icon path={<><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>} /> },
    { id: "blacklist", label: "ЧС", icon: <Icon path={<><circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" /></>} /> },
    { id: "folders", label: "Папки", icon: <Icon path={<><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></>} /> },
  ];

  // Фильтрация писем по поиску + активной папке
  const visibleRows = rows.filter((r) => matchesSearch(r, search) && matchesFolder(r, activeFolder));

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Шапка */}
        <div className="mb-6">
          <Link href={backHref} className="text-sm text-neutral-500 hover:text-neutral-800 dark:text-gray-400 dark:hover:text-white">
            {backLabel}
          </Link>
          <h1 className="mt-2 text-lg font-semibold text-neutral-900 dark:text-white">Email и обработка данных</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-gray-400">
            Почтовые ящики домена: входящие и исходящие письма, чёрный список, настройка папок.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          {/* Левая колонка: ящики + навигация */}
          <div className="space-y-3">
            {/* Переключатель разделов */}
            <div className="flex rounded-xl border border-neutral-200 bg-white p-1 dark:border-white/10 dark:bg-neutral-900">
              {SIDE_TABS.map((st) => (
                <button
                  key={st.id}
                  onClick={() => setSideTab(st.id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-colors ${
                    sideTab === st.id
                      ? "bg-violet-600 text-white dark:bg-cyan-600"
                      : "text-neutral-500 hover:text-neutral-800 dark:text-gray-400 dark:hover:text-white"
                  }`}
                >
                  {st.icon}{st.label}
                </button>
              ))}
            </div>

            {/* Ящики (видны всегда) */}
            {loadingList && <p className="text-sm text-neutral-400">Загрузка…</p>}
            {mailboxes.map((box) => {
              const isActive = box.localPart === selected;
              return (
                <button
                  key={box.localPart}
                  onClick={() => { setSelected(box.localPart); setSideTab("mail"); }}
                  className={`w-full rounded-xl border px-3.5 py-3 text-left transition-all duration-200 ${
                    isActive
                      ? "border-violet-400/60 bg-violet-500/5 dark:border-cyan-500/50 dark:bg-cyan-500/5"
                      : "border-neutral-200 bg-white hover:border-violet-300 dark:border-white/10 dark:bg-neutral-900 dark:hover:border-cyan-500/30"
                  }`}
                >
                  <p className="text-sm font-semibold text-neutral-900 dark:text-white">{box.address}</p>
                  <p className="truncate text-xs text-neutral-500 dark:text-gray-400">{box.purpose}</p>
                  <div className="mt-1.5 flex gap-3 text-[11px] text-neutral-400 dark:text-gray-500">
                    <span>↓ {box.incoming}</span>
                    <span>↑ {box.outgoing}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Правая колонка */}
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-neutral-900">

            {/* ══ ЧС ══ */}
            {sideTab === "blacklist" && <BlacklistPanel />}

            {/* ══ Папки ══ */}
            {sideTab === "folders" && (
              <FoldersPanel onFolderSelect={(f) => { setActiveFolder(f); if (f) setSideTab("mail"); }} />
            )}

            {/* ══ Почта ══ */}
            {sideTab === "mail" && (
              activeBox ? (
                <>
                  {/* Шапка ящика */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-neutral-900 dark:text-white">{activeBox.address}</p>
                      <p className="text-xs text-neutral-500 dark:text-gray-400">{activeBox.label}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        disabled={syncing}
                        onClick={async () => { if (!selected) return; await syncIncoming(selected); await loadRows(selected, tab, false); }}
                        className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:border-violet-400 hover:text-violet-600 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:text-gray-300 dark:hover:border-cyan-500/50 dark:hover:text-cyan-400"
                      >
                        {syncing ? "Проверяем…" : "Проверить почту"}
                      </button>
                      <button
                        onClick={() => setShowCompose((v) => !v)}
                        className="flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-700 dark:bg-cyan-600 dark:hover:bg-cyan-500"
                      >
                        <Icon path={<><path d="M12 5v14" /><path d="M5 12h14" /></>} />
                        Написать
                      </button>
                    </div>
                  </div>

                  {/* Вкладки + поиск */}
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <div className="flex gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-white/5">
                      {MAIN_TABS.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setTab(t.id)}
                          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                            tab === t.id
                              ? "bg-white text-violet-600 shadow-sm dark:bg-neutral-800 dark:text-cyan-400"
                              : "text-neutral-500 hover:text-neutral-800 dark:text-gray-400 dark:hover:text-white"
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>

                    {/* Поиск */}
                    <div className="relative flex-1 min-w-[160px]">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400">
                        <Icon path={<><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>} />
                      </span>
                      <input
                        ref={searchRef}
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setExpandedId(null); }}
                        placeholder="Поиск по ящику…"
                        className="w-full rounded-lg border border-neutral-200 bg-neutral-50 py-1.5 pl-8 pr-3 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-violet-400 focus:bg-white focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:border-cyan-500 dark:focus:bg-white/10"
                      />
                      {search && (
                        <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 dark:hover:text-white">
                          <Icon path={<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>} />
                        </button>
                      )}
                    </div>

                    {/* Индикатор активной папки */}
                    {activeFolder && (
                      <div
                        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium"
                        style={{ background: activeFolder.color + "20", color: activeFolder.color }}
                      >
                        <span>{activeFolder.icon}</span>
                        <span>{activeFolder.name}</span>
                        <button onClick={() => setActiveFolder(null)} className="ml-1 opacity-60 hover:opacity-100">×</button>
                      </div>
                    )}
                  </div>

                  {note && <p className="mt-3 text-xs text-neutral-500 dark:text-gray-400">{note}</p>}

                  {showCompose && (
                    <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/40 p-4 dark:border-cyan-500/20 dark:bg-cyan-500/5">
                      <MailComposer
                        key={selected ?? "compose"}
                        mailboxes={mailboxes}
                        templates={templates}
                        defaultMailbox={selected ?? undefined}
                        onSent={() => { setShowCompose(false); setTab("outgoing"); if (selected) loadRows(selected, "outgoing"); }}
                      />
                      <div className="mt-2 flex justify-end">
                        <button onClick={() => setShowCompose(false)} className="rounded-lg px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-800 dark:text-gray-400 dark:hover:text-white">Отмена</button>
                      </div>
                    </div>
                  )}

                  {/* Список писем */}
                  <div className="mt-4 space-y-2">
                    {loadingRows && <p className="text-sm text-neutral-400">Загрузка писем…</p>}

                    {!loadingRows && visibleRows.length === 0 && (
                      <p className="rounded-xl border border-dashed border-neutral-200 px-4 py-8 text-center text-sm text-neutral-400 dark:border-white/10 dark:text-gray-500">
                        {search ? "Ничего не найдено" : tab === "archive" ? "В архиве пусто" : "Писем пока нет"}
                      </p>
                    )}

                    {visibleRows.map((m) => (
                      <div key={m.id} className="rounded-xl border border-neutral-200 dark:border-white/10 overflow-hidden">
                        {/* Строка письма — клик разворачивает/сворачивает */}
                        <button
                          type="button"
                          className="w-full px-3.5 py-3 text-left hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors"
                          onClick={() => setExpandedId((prev) => (prev === m.id ? null : m.id))}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                  m.direction === "incoming"
                                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                    : "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                                }`}>
                                  {m.direction === "incoming" ? "Входящее" : "Исходящее"}
                                </span>
                                <span className="text-[11px] text-neutral-400 dark:text-gray-500">{formatDate(m.sentAt)}</span>
                                {/* Индикатор развёрнутости */}
                                <span className={`ml-auto text-neutral-300 dark:text-white/20 transition-transform duration-200 ${expandedId === m.id ? "rotate-180" : ""}`}>
                                  <Icon path={<path d="m6 9 6 6 6-6" />} />
                                </span>
                              </div>
                              <p className="mt-1 truncate text-sm font-medium text-neutral-900 dark:text-white">{m.subject || "(без темы)"}</p>
                              <p className="truncate text-xs text-neutral-500 dark:text-gray-400">
                                {m.direction === "incoming" ? `от ${m.fromAddr}` : `кому ${m.toAddr}`}
                              </p>
                              {expandedId !== m.id && (
                                <p className="mt-1 line-clamp-2 text-xs text-neutral-400 dark:text-gray-500">{m.preview}</p>
                              )}
                            </div>
                            {/* Действия */}
                            <div className="flex flex-shrink-0 flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <a
                                href={`/api/admin/mail/message/${m.id}/download`}
                                className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600 transition-colors hover:border-violet-400 hover:text-violet-600 dark:border-white/10 dark:text-gray-300 dark:hover:border-cyan-500/50 dark:hover:text-cyan-400"
                              >
                                <Icon path={<><path d="M12 3v12" /><path d="m7 12 5 5 5-5" /><path d="M5 21h14" /></>} />
                                Скачать
                              </a>
                              <button
                                onClick={() => archive(m.id, !m.archived)}
                                className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600 transition-colors hover:border-amber-400 hover:text-amber-600 dark:border-white/10 dark:text-gray-300 dark:hover:border-amber-500/50 dark:hover:text-amber-400"
                              >
                                <Icon path={<><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" /></>} />
                                {m.archived ? "Вернуть" : "Архив"}
                              </button>
                            </div>
                          </div>
                        </button>

                        {/* Развёрнутое тело письма */}
                        {expandedId === m.id && (
                          <div className="border-t border-neutral-100 px-3.5 pb-3 dark:border-white/5">
                            <MailDetailPanel
                              messageId={m.id}
                              onClose={() => setExpandedId(null)}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-neutral-400">Выберите ящик слева</p>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
