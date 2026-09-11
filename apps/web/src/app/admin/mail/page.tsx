"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAdminBackHref, useAdminBackLabel } from "@/components/admin/useAdminBackHref";

/**
 * PROJECT-MAIL: раздел «Email и обработка данных» админ-панели.
 *
 * Слева — ящики домена trioz.ru (info, sales, …), справа — история писем
 * выбранного ящика: входящие, исходящие и архив, до 10 писем в листинге.
 * Каждое письмо можно скачать (.eml) и архивировать / вернуть из архива.
 *
 * Сами ящики заводятся на хостинге домена и посевом базы — здесь их не
 * создают и не удаляют, только читают переписку.
 */

type Direction = "incoming" | "outgoing";
type Tab = Direction | "archive";

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

function Icon({ path }: { path: React.ReactNode }) {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      {path}
    </svg>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AdminMailPage() {
  const backHref = useAdminBackHref();
  const backLabel = useAdminBackLabel();
  const { data: session, status } = useSession();
  const router = useRouter();

  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("incoming");
  const [rows, setRows] = useState<MailRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [sending, setSending] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeText, setComposeText] = useState("");

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") router.push("/connect");
  }, [session, status, router]);

  useEffect(() => {
    fetch("/api/admin/mail", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const list: Mailbox[] = data?.mailboxes ?? [];
        setMailboxes(list);
        if (list.length && !selected) setSelected(list[0].localPart);
      })
      .catch(() => {})
      .finally(() => setLoadingList(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRows = useCallback((localPart: string, which: Tab) => {
    setLoadingRows(true);
    setNote(null);
    const params = new URLSearchParams();
    if (which === "archive") params.set("archived", "1");
    else params.set("direction", which);
    fetch(`/api/admin/mail/${encodeURIComponent(localPart)}?${params.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setRows(data?.messages ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoadingRows(false));
  }, []);

  useEffect(() => {
    if (selected) loadRows(selected, tab);
  }, [selected, tab, loadRows]);

  // Отправить письмо от имени выбранного ящика.
  const sendMail = useCallback(async () => {
    if (!selected) return;
    setSending(true);
    setNote(null);
    try {
      const res = await fetch(`/api/admin/mail/${encodeURIComponent(selected)}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: composeTo, subject: composeSubject, text: composeText }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setNote(data?.error || "Отправка не удалась");
        return;
      }
      setComposeTo("");
      setComposeSubject("");
      setComposeText("");
      setShowCompose(false);
      setNote("Письмо отправлено");
      setTab("outgoing");
      loadRows(selected, "outgoing");
    } catch {
      setNote("Отправка не удалась");
    } finally {
      setSending(false);
    }
  }, [selected, composeTo, composeSubject, composeText, loadRows]);

  const archive = useCallback(
    async (id: string, archived: boolean) => {
      if (!selected) return;
      // Оптимистично убираем строку — она уйдёт в другую вкладку.
      setRows((prev) => prev.filter((m) => m.id !== id));
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
    [selected, tab, loadRows],
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

  const TABS: { id: Tab; label: string }[] = [
    { id: "incoming", label: "Входящие" },
    { id: "outgoing", label: "Исходящие" },
    { id: "archive", label: "Архив" },
  ];

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6">
          <Link href={backHref} className="text-sm text-neutral-500 hover:text-neutral-800 dark:text-gray-400 dark:hover:text-white">
            {backLabel}
          </Link>
          <h1 className="mt-2 text-lg font-semibold text-neutral-900 dark:text-white">Email и обработка данных</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-gray-400">
            Почтовые ящики домена trioz.ru: входящие и исходящие письма, скачивание и архив.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          {/* Левая колонка: ящики */}
          <div className="space-y-2">
            {loadingList && <p className="text-sm text-neutral-400">Загрузка…</p>}
            {mailboxes.map((box) => {
              const isActive = box.localPart === selected;
              return (
                <button
                  key={box.localPart}
                  onClick={() => setSelected(box.localPart)}
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

          {/* Правая колонка: листинг */}
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-neutral-900">
            {activeBox ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-neutral-900 dark:text-white">{activeBox.address}</p>
                    <p className="text-xs text-neutral-500 dark:text-gray-400">{activeBox.label}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setShowCompose((v) => !v)}
                      className="flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-700 dark:bg-cyan-600 dark:hover:bg-cyan-500"
                    >
                      <Icon path={<><path d="M12 5v14" /><path d="M5 12h14" /></>} />
                      Написать
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex justify-end">
                  <div className="flex gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-white/5">
                    {TABS.map((t) => (
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
                </div>

                {note && <p className="mt-3 text-xs text-neutral-500 dark:text-gray-400">{note}</p>}

                {showCompose && (
                  <div className="mt-4 space-y-2 rounded-xl border border-violet-200 bg-violet-50/40 p-4 dark:border-cyan-500/20 dark:bg-cyan-500/5">
                    <p className="text-xs font-medium text-neutral-500 dark:text-gray-400">
                      Новое письмо от {activeBox.address}
                    </p>
                    <input
                      type="email"
                      value={composeTo}
                      onChange={(e) => setComposeTo(e.target.value)}
                      placeholder="Кому (например noperight81@gmail.com)"
                      className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-violet-400 dark:border-white/10 dark:bg-neutral-900 dark:text-white dark:focus:border-cyan-500/50"
                    />
                    <input
                      type="text"
                      value={composeSubject}
                      onChange={(e) => setComposeSubject(e.target.value)}
                      placeholder="Тема"
                      className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-violet-400 dark:border-white/10 dark:bg-neutral-900 dark:text-white dark:focus:border-cyan-500/50"
                    />
                    <textarea
                      value={composeText}
                      onChange={(e) => setComposeText(e.target.value)}
                      placeholder="Текст письма"
                      rows={5}
                      className="w-full resize-y rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-violet-400 dark:border-white/10 dark:bg-neutral-900 dark:text-white dark:focus:border-cyan-500/50"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setShowCompose(false)}
                        className="rounded-lg px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-800 dark:text-gray-400 dark:hover:text-white"
                      >
                        Отмена
                      </button>
                      <button
                        onClick={sendMail}
                        disabled={sending}
                        className="rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50 dark:bg-cyan-600 dark:hover:bg-cyan-500"
                      >
                        {sending ? "Отправка…" : "Отправить"}
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-4 space-y-2">
                  {loadingRows && <p className="text-sm text-neutral-400">Загрузка писем…</p>}
                  {!loadingRows && rows.length === 0 && (
                    <p className="rounded-xl border border-dashed border-neutral-200 px-4 py-8 text-center text-sm text-neutral-400 dark:border-white/10 dark:text-gray-500">
                      {tab === "archive" ? "В архиве пусто" : "Писем пока нет — данные ещё не получены"}
                    </p>
                  )}
                  {rows.map((m) => (
                    <div
                      key={m.id}
                      className="rounded-xl border border-neutral-200 px-3.5 py-3 dark:border-white/10"
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
                          </div>
                          <p className="mt-1 truncate text-sm font-medium text-neutral-900 dark:text-white">{m.subject}</p>
                          <p className="truncate text-xs text-neutral-500 dark:text-gray-400">
                            {m.direction === "incoming" ? `от ${m.fromAddr}` : `кому ${m.toAddr}`}
                          </p>
                          <p className="mt-1 line-clamp-2 text-xs text-neutral-400 dark:text-gray-500">{m.preview}</p>
                        </div>
                        <div className="flex flex-shrink-0 flex-col gap-1.5">
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
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-neutral-400">Выберите ящик слева</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
