"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAdminBackHref, useAdminBackLabel } from "@/components/admin/useAdminBackHref";
import MailComposer from "@/components/admin/mail/MailComposer";
import { listingParams } from "@/lib/mailListing";

/**
 * PROJECT-MAIL — раздел «Email и обработка данных» админ-панели.
 *
 * Функции:
 *  1. История ящика постранично: «Показать ещё» и «показано X из Y».
 *     Выборка, поиск и фильтр папки считаются в базе, а не по видимым строкам.
 *  2. Полное открытие письма — клик на строке разворачивает панель с bodyHtml.
 *  3. Чёрный список адресов — вкладка «ЧС», CRUD через /api/admin/mail/blacklist.
 *  4. Режим папок — CRUD через /api/admin/mail/folders.
 *     Папка = сохранённый фильтр по направлению/адресу/теме.
 *
 * Чего здесь намеренно нет: опроса IMAP на клик по ящику и на переключение
 * вкладок. Он был — и каждое нажатие тянуло почту заново, а сломанный дедуп
 * плодил копии писем, из-за чего счётчики в списке ящиков росли от нажатий.
 * Теперь почту забирает кнопка «Проверить почту» и cron (/api/mail/poll),
 * а экран сам только перечитывает базу.
 */

// ─── types ───────────────────────────────────────────────────────────────────

type Direction = "incoming" | "outgoing";
type MainTab = Direction | "archive" | "trash";
type SideTab = "mail" | "blacklist" | "folders";

interface Mailbox {
  localPart: string;
  address: string;
  label: string;
  purpose: string;
  active: boolean;
  lastSyncAt?: string | null;
  lastSyncError?: string | null;
}

interface MailRow {
  id: string;
  direction: Direction;
  fromAddr: string;
  toAddr: string;
  subject: string;
  preview: string;
  archived: boolean;
  trashedAt?: string | null;
  readAt?: string | null;
  deliveryStatus?: "pending" | "sent" | "failed";
  deliveryError?: string | null;
  sentAt: string;
}

interface MailDetail {
  id: string;
  direction: Direction;
  fromAddr: string;
  fromName?: string;
  toAddr: string;
  ccAddr?: string;
  subject: string;
  bodyHtml?: string;
  bodyText?: string;
  messageId?: string;
  archived?: boolean;
  trashedAt?: string | null;
  deliveryStatus?: string;
  deliveryError?: string | null;
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

/** Сколько писем запрашиваем за одну страницу листинга (совпадает с MAIL_PAGE_SIZE). */
const PAGE_SIZE = 25;

/** Как часто молча перечитываем текущую выборку из базы. */
const REFRESH_MS = 30000;

const FOLDER_COLORS = ["#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#6366f1"];
const FOLDER_ICONS = ["📁", "⭐", "📌", "🔔", "📨", "📤", "💼", "💡"];

// ─── sub-components ───────────────────────────────────────────────────────────

/** Полное просмотр письма — инлайн-панель под строкой */
function MailDetailPanel({
  messageId, onClose, onReply, onArchive, onTrash, onRead,
}: {
  messageId: string;
  onClose: () => void;
  onReply: (mode: "reply" | "replyAll" | "forward", detail: MailDetail) => void;
  onArchive: (id: string, archived: boolean) => void;
  onTrash: (id: string) => void;
  onRead: (id: string) => void;
}) {
  const [detail, setDetail] = useState<MailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/admin/mail/message/${messageId}/view`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => { setDetail(data.message); onRead(messageId); })
      .catch(() => setError("Не удалось загрузить письмо"))
      .finally(() => setLoading(false));
  }, [messageId, onRead]);

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
          <div className="flex flex-wrap gap-2">
            <button onClick={() => onReply("reply", detail)} className="rounded-lg border px-2.5 py-1 text-xs">Ответить</button>
            <button onClick={() => onReply("replyAll", detail)} className="rounded-lg border px-2.5 py-1 text-xs">Ответить всем</button>
            <button onClick={() => onReply("forward", detail)} className="rounded-lg border px-2.5 py-1 text-xs">Переслать</button>
            {!detail.trashedAt && <button onClick={() => onArchive(detail.id, !detail.archived)} className="rounded-lg border px-2.5 py-1 text-xs">{detail.archived ? "Вернуть из архива" : "Архивировать"}</button>}
            {!detail.trashedAt && <button onClick={() => onTrash(detail.id)} className="rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-600">Удалить</button>}
          </div>
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
              <pre className="whitespace-pre-wrap px-4 py-6 text-sm text-neutral-700 dark:text-gray-200">{detail.bodyText || "Тело письма недоступно"}</pre>
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
  const [archiveDir, setArchiveDir] = useState<Direction | "">("");
  const [sideTab, setSideTab] = useState<SideTab>("mail");
  const [rows, setRows] = useState<MailRow[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [composeReply, setComposeReply] = useState<{ messageId?: string; subject?: string; quotedHtml?: string; to?: string[]; cc?: string[] } | undefined>();
  const [composeKey, setComposeKey] = useState(0);
  const [templates, setTemplates] = useState<Array<{ key: string; name: string; subject: string; format: string; body: string }>>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [activeFolder, setActiveFolder] = useState<MailFolder | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  /**
   * Сколько строк уже показано — нужно фоновому обновлению, чтобы перечитать
   * ровно открытое окно истории, а не схлопнуть его до первой страницы.
   * Через ref, а не через зависимость: иначе колбэк пересоздавался бы на
   * каждую загруженную страницу и перезапускал таймер.
   */
  const loadedRef = useRef(0);
  /** Номер последнего запроса: ответ отставшего запроса не должен перетирать свежий. */
  const requestRef = useRef(0);

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

  /**
   * Загрузка страницы истории ящика.
   *
   * "replace" — первая страница (смена ящика, вкладки, поиска, папки);
   * "append"  — «Показать ещё»: дописываем следующую страницу;
   * "silent"  — фоновое обновление: перечитываем уже открытое окно, не мигая
   *             спиннером и не сбрасывая развёрнутое письмо.
   */
  const load = useCallback(
    async (mode: "replace" | "append" | "silent") => {
      if (!selected) return;
      const offset = mode === "append" ? loadedRef.current : 0;
      const limit = mode === "silent" ? Math.max(PAGE_SIZE, loadedRef.current) : PAGE_SIZE;
      const ticket = ++requestRef.current;

      if (mode === "replace") setLoadingRows(true);
      if (mode === "append") setLoadingMore(true);
      try {
        const qs = listingParams({
          tab,
          archiveDir,
          query,
          folder: activeFolder?.filter ?? null,
          offset,
          limit,
        });
        const res = await fetch(`/api/admin/mail/${encodeURIComponent(selected)}?${qs}`, { cache: "no-store" });
        const data = res.ok ? await res.json() : null;
        // Пока ответ шёл, пользователь мог переключить ящик или вкладку.
        if (ticket !== requestRef.current) return;
        const page: MailRow[] = data?.messages ?? [];
        setRows((prev) => (mode === "append" ? [...prev, ...page] : page));
        setTotal(Number(data?.total ?? page.length));
        setHasMore(Boolean(data?.hasMore));
        loadedRef.current = mode === "append" ? offset + page.length : page.length;
        if (mode === "replace") setExpandedId(null);
      } catch {
        if (ticket !== requestRef.current) return;
        if (mode !== "silent") {
          setRows([]);
          setTotal(0);
          setHasMore(false);
          loadedRef.current = 0;
        }
      } finally {
        if (mode === "replace") setLoadingRows(false);
        if (mode === "append") setLoadingMore(false);
      }
    },
    [selected, tab, archiveDir, query, activeFolder],
  );

  /**
   * Забрать почту с сервера по IMAP. Только по явной команде: на клик по
   * ящику это больше не висит — оттуда и росли счётчики.
   */
  const syncIncoming = useCallback(async () => {
    if (!selected) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/mail/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: selected }),
      });
      const data = await res.json().catch(() => ({}));
      const details = Array.isArray(data?.errors)
        ? data.errors.map((e: { error?: string }) => e?.error).filter(Boolean).join("; ")
        : "";
      if (!res.ok) {
        setMailboxes((items) => items.map((box) => box.localPart === selected ? { ...box, lastSyncAt: new Date().toISOString(), lastSyncError: details || "Ошибка синхронизации" } : box));
        setNote(details ? `Не удалось проверить почту: ${details}` : "Не удалось проверить входящие письма");
        return;
      }
      setMailboxes((items) => items.map((box) => box.localPart === selected ? { ...box, lastSyncAt: data?.lastSyncAt || new Date().toISOString(), lastSyncError: details || null } : box));
      if (details) {
        setNote(`Почта проверена с ошибкой: ${details}`);
      } else if (Number(data?.stored || 0) > 0) {
        setNote(`Получено новых писем: ${data.stored}`);
      } else {
        setNote("Входящие проверены: новых писем нет");
      }
      await load("silent");
    } catch {
      setNote("Ошибка синхронизации");
    } finally {
      setSyncing(false);
    }
  }, [selected, load]);

  // Поиск с задержкой: в базу не стоит ходить на каждую букву.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Смена ящика, вкладки, поиска или папки — читаем первую страницу заново.
  useEffect(() => { void load("replace"); }, [load]);

  // Фоновое обновление: только перечитывает базу, IMAP не трогает.
  useEffect(() => {
    if (!selected || sideTab !== "mail") return;
    const timer = window.setInterval(() => { void load("silent"); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [selected, sideTab, load]);

  // Уведомление не должно висеть вечно.
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), 6000);
    return () => window.clearTimeout(timer);
  }, [note]);

  // Сбрасываем поиск и развёрнутое письмо при смене ящика / вкладки
  useEffect(() => { setSearch(""); setQuery(""); setExpandedId(null); }, [selected, tab]);

  const activeBox = mailboxes.find((m) => m.localPart === selected) ?? null;

  const archive = useCallback(
    async (id: string, archived: boolean) => {
      if (!selected) return;
      setRows((prev) => prev.filter((m) => m.id !== id));
      setTotal((prev) => Math.max(0, prev - 1));
      loadedRef.current = Math.max(0, loadedRef.current - 1);
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
        void load("replace");
      }
    },
    [selected, expandedId, load],
  );

  const action = useCallback(async (id: string, mailAction: "trash" | "restore") => {
    if (!selected) return;
    const res = await fetch(`/api/admin/mail/${encodeURIComponent(selected)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: mailAction }),
    }).catch(() => null);
    if (!res?.ok) setNote("Не удалось обновить письмо");
    await load("replace");
  }, [selected, load]);

  const permanentlyDelete = useCallback(async (id: string) => {
    if (!selected || !window.confirm("Удалить письмо навсегда? Это действие нельзя отменить.")) return;
    const res = await fetch(`/api/admin/mail/${encodeURIComponent(selected)}?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => null);
    if (!res?.ok) setNote("Не удалось удалить письмо");
    await load("replace");
  }, [selected, load]);

  const markReadLocally = useCallback((id: string) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, readAt: row.readAt || new Date().toISOString() } : row));
  }, []);

  const openComposer = useCallback((mode?: "reply" | "replyAll" | "forward", detail?: MailDetail) => {
    if (!mode || !detail) {
      setComposeReply(undefined);
    } else {
      const split = (value?: string) => (value || "").split(",").map((part) => part.trim()).filter(Boolean);
      const quotedHtml = detail.bodyHtml || `<pre>${(detail.bodyText || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`;
      if (mode === "forward") {
        setComposeReply({ subject: /^fwd:/i.test(detail.subject) ? detail.subject : `Fwd: ${detail.subject}`, quotedHtml });
      } else {
        const sender = detail.fromAddr ? [detail.fromAddr] : [];
        const all = mode === "replyAll" ? [...split(detail.toAddr), ...split(detail.ccAddr)] : [];
        const current = activeBox?.address.toLowerCase();
        setComposeReply({
          messageId: detail.messageId,
          subject: /^re:/i.test(detail.subject) ? detail.subject : `Re: ${detail.subject}`,
          quotedHtml,
          to: sender,
          cc: all.filter((address, index, values) => address.toLowerCase() !== current && !sender.some((s) => s.toLowerCase() === address.toLowerCase()) && values.indexOf(address) === index),
        });
      }
    }
    setComposeKey((value) => value + 1);
    setShowCompose(true);
  }, [activeBox?.address]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-violet-500" />
      </div>
    );
  }
  if (session?.user?.role !== "ADMIN") return null;

  const MAIN_TABS: { id: MainTab; label: string }[] = [
    { id: "incoming", label: "Входящие" },
    { id: "outgoing", label: "Исходящие" },
    { id: "archive", label: "Архив" },
    { id: "trash", label: "Корзина" },
  ];

  const SIDE_TABS: { id: SideTab; label: string; icon: React.ReactNode }[] = [
    { id: "mail", label: "Почта", icon: <Icon path={<><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>} /> },
    { id: "blacklist", label: "ЧС", icon: <Icon path={<><circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" /></>} /> },
    { id: "folders", label: "Папки", icon: <Icon path={<><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></>} /> },
  ];

  const ARCHIVE_DIRS: { id: Direction | ""; label: string }[] = [
    { id: "", label: "Все" },
    { id: "incoming", label: "Входящие" },
    { id: "outgoing", label: "Исходящие" },
  ];

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
                      <p className="mt-1 text-[11px] text-neutral-400">
                        Последняя проверка: {activeBox.lastSyncAt ? formatDate(activeBox.lastSyncAt) : "ещё не выполнялась"}
                        {activeBox.lastSyncError ? " · Ошибка синхронизации" : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        disabled={syncing}
                        onClick={() => { void syncIncoming(); }}
                        className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:border-violet-400 hover:text-violet-600 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:text-gray-300 dark:hover:border-cyan-500/50 dark:hover:text-cyan-400"
                      >
                        {syncing ? "Проверяем…" : "Проверить почту"}
                      </button>
                      <button
                        onClick={() => showCompose ? setShowCompose(false) : openComposer()}
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
                          onClick={() => { setTab(t.id); if (t.id !== "archive" && t.id !== "trash") setArchiveDir(""); }}
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

                    {/* Направление внутри архива: раньше архив валил входящие и
                        исходящие в одну кучу, и раздельной истории там не было. */}
                    {(tab === "archive" || tab === "trash") && (
                      <div className="flex gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-white/5">
                        {ARCHIVE_DIRS.map((d) => (
                          <button
                            key={d.id || "all"}
                            onClick={() => setArchiveDir(d.id)}
                            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                              archiveDir === d.id
                                ? "bg-white text-violet-600 shadow-sm dark:bg-neutral-800 dark:text-cyan-400"
                                : "text-neutral-500 hover:text-neutral-800 dark:text-gray-400 dark:hover:text-white"
                            }`}
                          >
                            {d.label}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Поиск */}
                    <div className="relative flex-1 min-w-[160px]">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400">
                        <Icon path={<><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>} />
                      </span>
                      <input
                        ref={searchRef}
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setExpandedId(null); }}
                        placeholder="Поиск по всей истории ящика…"
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
                        key={`${selected ?? "compose"}:${composeKey}`}
                        mailboxes={mailboxes}
                        templates={templates}
                        defaultMailbox={selected ?? undefined}
                        replyTo={composeReply}
                        onSent={() => {
                          setShowCompose(false); setComposeReply(undefined);
                          setArchiveDir(""); setTab("outgoing");
                          window.setTimeout(() => { void load("replace"); }, 0);
                        }}
                      />
                      <div className="mt-2 flex justify-end">
                        <button onClick={() => setShowCompose(false)} className="rounded-lg px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-800 dark:text-gray-400 dark:hover:text-white">Отмена</button>
                      </div>
                    </div>
                  )}

                  {/* Сколько писем показано из всей выборки — без этого не
                      видно, что история длиннее одной страницы. */}
                  {!loadingRows && rows.length > 0 && (
                    <p className="mt-3 text-[11px] text-neutral-400 dark:text-gray-500">
                      Показано {rows.length} из {total}
                    </p>
                  )}

                  {/* Список писем */}
                  <div className="mt-2 space-y-2">
                    {loadingRows && <p className="text-sm text-neutral-400">Загрузка писем…</p>}

                    {!loadingRows && rows.length === 0 && (
                      <p className="rounded-xl border border-dashed border-neutral-200 px-4 py-8 text-center text-sm text-neutral-400 dark:border-white/10 dark:text-gray-500">
                        {query ? "Ничего не найдено" : tab === "archive" ? "В архиве пусто" : tab === "trash" ? "Корзина пуста" : "Писем пока нет"}
                      </p>
                    )}

                    {rows.map((m) => (
                      <div key={m.id} className={`rounded-xl border border-neutral-200 dark:border-white/10 overflow-hidden ${m.direction === "incoming" && !m.readAt ? "bg-violet-50/40 dark:bg-cyan-500/5" : ""}`}>
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
                              <div className="mt-1 flex gap-2 text-[10px]">
                                {m.direction === "incoming" && <span className={!m.readAt ? "font-semibold text-violet-600 dark:text-cyan-400" : "text-neutral-400"}>{m.readAt ? "Прочитано" : "Непрочитано"}</span>}
                                {m.direction === "outgoing" && <span className={m.deliveryStatus === "failed" ? "text-red-600" : m.deliveryStatus === "pending" ? "text-amber-600" : "text-emerald-600"}>
                                  {m.deliveryStatus === "failed" ? "Ошибка отправки" : m.deliveryStatus === "pending" ? "Отправляется / статус уточняется" : "Отправлено"}
                                </span>}
                              </div>
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
                              {tab !== "trash" && <button
                                onClick={() => archive(m.id, !m.archived)}
                                className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600 transition-colors hover:border-amber-400 hover:text-amber-600 dark:border-white/10 dark:text-gray-300 dark:hover:border-amber-500/50 dark:hover:text-amber-400"
                              >
                                <Icon path={<><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" /></>} />
                                {m.archived ? "Вернуть" : "Архив"}
                              </button>}
                              {tab !== "trash" ? (
                                <button onClick={() => action(m.id, "trash")} className="rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-600">Удалить</button>
                              ) : (
                                <>
                                  <button onClick={() => action(m.id, "restore")} className="rounded-lg border px-2.5 py-1 text-xs">Восстановить</button>
                                  <button onClick={() => permanentlyDelete(m.id)} className="rounded-lg border border-red-300 px-2.5 py-1 text-xs text-red-700">Удалить навсегда</button>
                                </>
                              )}
                            </div>
                          </div>
                        </button>

                        {/* Развёрнутое тело письма */}
                        {expandedId === m.id && (
                          <div className="border-t border-neutral-100 px-3.5 pb-3 dark:border-white/5">
                            <MailDetailPanel
                              messageId={m.id}
                              onClose={() => setExpandedId(null)}
                              onReply={openComposer}
                              onArchive={archive}
                              onTrash={(id) => { void action(id, "trash"); }}
                              onRead={markReadLocally}
                            />
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Пагинация: до этого всё, что старше десятого письма,
                        было недостижимо из интерфейса вообще. */}
                    {hasMore && (
                      <button
                        onClick={() => { void load("append"); }}
                        disabled={loadingMore}
                        className="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-xs font-medium text-neutral-600 transition-colors hover:border-violet-400 hover:text-violet-600 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:text-gray-300 dark:hover:border-cyan-500/50 dark:hover:text-cyan-400"
                      >
                        {loadingMore ? "Загрузка…" : `Показать ещё (осталось ${total - rows.length})`}
                      </button>
                    )}
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
