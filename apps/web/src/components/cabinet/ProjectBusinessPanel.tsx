"use client";

import { useCallback, useEffect, useRef, useState } from "react";
/* Виды документов повторены здесь сознательно: lib/projectBusiness.ts импортирует
   prisma, а этот компонент клиентский — общий импорт затащил бы серверный код
   в браузерный бандл. Значения обязаны совпадать с DOCUMENT_KINDS на сервере. */
const DOCUMENT_KINDS = ["CONTRACT", "ACT", "APPENDIX", "OTHER"] as const;
type DocumentKind = (typeof DOCUMENT_KINDS)[number];
const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  CONTRACT: "Договор",
  ACT: "Акт",
  APPENDIX: "Приложение",
  OTHER: "Документ",
};

/**
 * BUSINESS-CABINET: счета, документы, сроки и история проекта.
 *
 * Раньше всё это существовало только словами в деловом чате: партнёр не видел ни
 * суммы, ни срока, ни ответственного — только переписку. Один компонент на две стороны:
 * сотрудник (isStaff) редактирует, клиент только смотрит и может сообщить об оплате.
 *
 * Важно: права здесь только для вида. Все проверки повторены на сервере
 * (lib/projectBusiness.ts), потому что скрытая кнопка — не защита.
 */

type Invoice = {
  id: string;
  number: number;
  title: string;
  amount: number;
  currency: string;
  status: string;
  method: string | null;
  reference: string | null;
  note: string | null;
  dueDate: string | null;
  paidAt: string | null;
  createdByName: string;
  createdAt: string;
};

type Document = {
  id: string;
  kind: string;
  name: string;
  url: string;
  size: number;
  uploadedByName: string;
  createdAt: string;
};

type Event = {
  id: string;
  kind: string;
  title: string;
  details: string | null;
  actorName: string;
  actorSide: string;
  createdAt: string;
};

type ProjectMeta = {
  dueDate: string | null;
  responsible: { id: string; name: string | null; username: string | null } | null;
};

const MAX_FILE_SIZE = 25 * 1024 * 1024;

const STATUS_LABEL: Record<string, string> = {
  UNPAID: "Ожидает оплаты",
  PAID: "Оплачен",
  CANCELLED: "Отменён",
};

const STATUS_TINT: Record<string, string> = {
  UNPAID: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  PAID: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  CANCELLED: "bg-neutral-500/10 text-neutral-500",
};

/** Суммы хранятся в копейках: целые числа не дают ошибок округления в сводках. */
export function formatMoney(minor: number, currency = "RUB") {
  const value = (minor / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value} ${currency === "RUB" ? "₽" : currency}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("ru-RU");
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-neutral-900">
      <div className="mb-2">
        <p className="text-sm font-semibold text-neutral-900 dark:text-white">{title}</p>
        {hint && <p className="text-[11px] text-neutral-500 dark:text-gray-400">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export default function ProjectBusinessPanel({ projectId, isStaff }: { projectId: string; isStaff: boolean }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [meta, setMeta] = useState<ProjectMeta>({ dueDate: null, responsible: null });
  const [summary, setSummary] = useState({ billed: 0, paid: 0, unpaid: 0 });

  // Форма нового счёта (только сотрудник).
  const [invoiceTitle, setInvoiceTitle] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [invoiceDue, setInvoiceDue] = useState("");
  const [docKind, setDocKind] = useState<DocumentKind>("CONTRACT");
  const [dueDraft, setDueDraft] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [invoicesRes, documentsRes, historyRes, projectRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/invoices`, { cache: "no-store" }),
        fetch(`/api/projects/${projectId}/documents`, { cache: "no-store" }),
        fetch(`/api/projects/${projectId}/history`, { cache: "no-store" }),
        fetch(`/api/projects/${projectId}`, { cache: "no-store" }),
      ]);
      const invoicesData = await invoicesRes.json().catch(() => null);
      const documentsData = await documentsRes.json().catch(() => null);
      const historyData = await historyRes.json().catch(() => null);
      const projectData = await projectRes.json().catch(() => null);

      setInvoices(Array.isArray(invoicesData?.invoices) ? invoicesData.invoices : []);
      setSummary(invoicesData?.summary ?? { billed: 0, paid: 0, unpaid: 0 });
      setDocuments(Array.isArray(documentsData?.documents) ? documentsData.documents : []);
      setEvents(Array.isArray(historyData?.events) ? historyData.events : []);
      const dueDate: string | null = projectData?.project?.dueDate ?? null;
      setMeta({ dueDate, responsible: projectData?.project?.responsible ?? null });
      setDueDraft(dueDate ? String(dueDate).slice(0, 10) : "");
    } catch {
      setError("Не удалось загрузить деловые данные проекта");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const request = async (url: string, init: RequestInit) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Не удалось выполнить действие");
        return false;
      }
      await load();
      return true;
    } catch {
      setError("Нет соединения с сервером");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const createInvoice = async () => {
    const rubles = Number(invoiceAmount.replace(",", "."));
    if (!invoiceTitle.trim()) { setError("Укажите назначение счёта"); return; }
    if (!Number.isFinite(rubles) || rubles < 0) { setError("Укажите сумму"); return; }
    const ok = await request(`/api/projects/${projectId}/invoices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: invoiceTitle.trim(),
        amount: Math.round(rubles * 100),
        dueDate: invoiceDue || null,
      }),
    });
    if (ok) { setInvoiceTitle(""); setInvoiceAmount(""); setInvoiceDue(""); }
  };

  const setInvoiceStatus = (invoice: Invoice, status: string) =>
    request(`/api/projects/${projectId}/invoices/${invoice.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

  const declarePaid = (invoice: Invoice) =>
    request(`/api/projects/${projectId}/invoices/${invoice.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ declare: true }),
    });

  const saveDueDate = () =>
    request(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dueDate: dueDraft || null }),
    });

  const toggleResponsible = (take: boolean) =>
    request(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ responsible: take ? "self" : null }),
    });

  const uploadDocument = async (file: File) => {
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) { setError("Файл слишком большой (макс. 25 МБ)"); return; }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const uploadRes = await fetch("/api/projects/upload", { method: "POST", body: form });
      const uploaded = await uploadRes.json().catch(() => null);
      if (!uploadRes.ok || !uploaded?.url) {
        setError(uploaded?.error || "Не удалось загрузить файл");
        return;
      }
      await request(`/api/projects/${projectId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: docKind,
          name: uploaded.name || file.name,
          url: uploaded.url,
          size: uploaded.size ?? file.size,
          mime: uploaded.type ?? file.type,
        }),
      });
    } catch {
      setError("Нет соединения с сервером");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeDocument = (doc: Document) => {
    if (!window.confirm(`Убрать документ «${doc.name}» из карточки проекта?`)) return;
    void request(`/api/projects/${projectId}/documents/${doc.id}`, { method: "DELETE" });
  };

  const inputCls =
    "w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-violet-500 dark:border-white/10 dark:bg-neutral-950 dark:text-white dark:focus:border-cyan-500";
  const btnCls =
    "rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50 dark:bg-cyan-500 dark:text-neutral-950 dark:hover:bg-cyan-400";
  const ghostCls =
    "rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[11px] font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5";

  if (loading) {
    return <p className="text-xs text-neutral-400">Загрузка деловых данных…</p>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-red-500">{error}</p>}

      <Section title="Сроки и ответственный" hint="Закреплено на сервере, а не только в переписке">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <p className="text-neutral-700 dark:text-neutral-200">
            Срок сдачи: <span className="font-medium">{formatDate(meta.dueDate)}</span>
          </p>
          <p className="text-neutral-700 dark:text-neutral-200">
            Ответственный: <span className="font-medium">{meta.responsible?.name || meta.responsible?.username || "не назначен"}</span>
          </p>
        </div>
        {isStaff && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input type="date" value={dueDraft} onChange={(e) => setDueDraft(e.target.value)} className={`${inputCls} max-w-[190px]`} />
            <button type="button" onClick={() => void saveDueDate()} disabled={busy} className={btnCls}>Сохранить срок</button>
            {meta.responsible ? (
              <button type="button" onClick={() => void toggleResponsible(false)} disabled={busy} className={ghostCls}>Снять ответственного</button>
            ) : (
              <button type="button" onClick={() => void toggleResponsible(true)} disabled={busy} className={ghostCls}>Взять на себя</button>
            )}
          </div>
        )}
      </Section>

      <Section title="Счета и оплаты" hint={`Выставлено ${formatMoney(summary.billed)} · оплачено ${formatMoney(summary.paid)} · остаток ${formatMoney(summary.unpaid)}`}>
        {invoices.length === 0 ? (
          <p className="text-xs text-neutral-400">Счетов пока нет</p>
        ) : (
          <ul className="space-y-2">
            {invoices.map((invoice) => (
              <li key={invoice.id} className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-white/10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-neutral-900 dark:text-white">№{invoice.number} · {invoice.title}</p>
                    <p className="text-[11px] text-neutral-500 dark:text-gray-400">
                      {formatMoney(invoice.amount, invoice.currency)} · срок {formatDate(invoice.dueDate)} · выставил {invoice.createdByName || "—"}
                      {invoice.paidAt ? ` · оплачен ${formatDate(invoice.paidAt)}` : ""}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TINT[invoice.status] || STATUS_TINT.CANCELLED}`}>
                    {STATUS_LABEL[invoice.status] || invoice.status}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {isStaff ? (
                    <>
                      {invoice.status !== "PAID" && (
                        <button type="button" onClick={() => void setInvoiceStatus(invoice, "PAID")} disabled={busy} className={ghostCls}>Отметить оплаченным</button>
                      )}
                      {invoice.status !== "UNPAID" && (
                        <button type="button" onClick={() => void setInvoiceStatus(invoice, "UNPAID")} disabled={busy} className={ghostCls}>Вернуть в ожидание</button>
                      )}
                      {invoice.status !== "CANCELLED" && (
                        <button type="button" onClick={() => void setInvoiceStatus(invoice, "CANCELLED")} disabled={busy} className={ghostCls}>Отменить</button>
                      )}
                    </>
                  ) : (
                    invoice.status === "UNPAID" && (
                      <button type="button" onClick={() => void declarePaid(invoice)} disabled={busy} className={ghostCls}>Сообщить об оплате</button>
                    )
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {isStaff && (
          <div className="mt-3 grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
            <input value={invoiceTitle} onChange={(e) => setInvoiceTitle(e.target.value)} placeholder="Назначение счёта" className={inputCls} />
            <input value={invoiceAmount} onChange={(e) => setInvoiceAmount(e.target.value)} placeholder="Сумма, ₽" inputMode="decimal" className={inputCls} />
            <input type="date" value={invoiceDue} onChange={(e) => setInvoiceDue(e.target.value)} className={inputCls} />
            <button type="button" onClick={() => void createInvoice()} disabled={busy} className={btnCls}>Выставить</button>
          </div>
        )}
      </Section>

      <Section title="Документы и договоры" hint="Файлы лежат в закрытом хранилище: доступ проверяет сервер">
        {documents.length === 0 ? (
          <p className="text-xs text-neutral-400">Документов пока нет</p>
        ) : (
          <ul className="space-y-1.5">
            {documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 px-3 py-2 dark:border-white/10">
                <div className="min-w-0">
                  <a href={doc.url} target="_blank" rel="noreferrer" className="truncate text-sm font-medium text-violet-600 hover:underline dark:text-cyan-400">
                    {doc.name}
                  </a>
                  <p className="text-[11px] text-neutral-500 dark:text-gray-400">
                    {DOCUMENT_KIND_LABEL[(doc.kind as DocumentKind)] || doc.kind} · {formatDate(doc.createdAt)} · {doc.uploadedByName || "—"}
                  </p>
                </div>
                {isStaff && (
                  <button type="button" onClick={() => removeDocument(doc)} disabled={busy} className={ghostCls}>Убрать</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {isStaff && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select value={docKind} onChange={(e) => setDocKind(e.target.value as DocumentKind)} className={`${inputCls} max-w-[170px]`}>
              {DOCUMENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>{DOCUMENT_KIND_LABEL[kind]}</option>
              ))}
            </select>
            <input
              ref={fileRef}
              type="file"
              onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadDocument(file); }}
              disabled={busy}
              className="text-xs text-neutral-500 dark:text-gray-400"
            />
          </div>
        )}
      </Section>

      <Section title="История этапов" hint="Все изменения по проекту в обратном порядке">
        {events.length === 0 ? (
          <p className="text-xs text-neutral-400">Записей пока нет</p>
        ) : (
          <ol className="space-y-1.5">
            {events.map((event) => (
              <li key={event.id} className="border-l-2 border-neutral-200 pl-3 dark:border-white/10">
                <p className="text-sm text-neutral-800 dark:text-neutral-100">{event.title}</p>
                <p className="text-[11px] text-neutral-500 dark:text-gray-400">
                  {new Date(event.createdAt).toLocaleString("ru-RU")} · {event.actorName || "—"}
                  {event.actorSide === "CLIENT" ? " · клиент" : ""}
                  {event.details ? ` · ${event.details}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}
