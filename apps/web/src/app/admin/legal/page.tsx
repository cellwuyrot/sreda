"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import Spinner from "@/components/ui/Spinner";
import {
  legacyLegalOverrides,
  LEGAL_CONTACTS,
  LEGAL_DEFAULTS,
  LEGAL_SECTIONS,
  legalKeys,
} from "@/lib/legal";

/* FIX-LEGAL: Админ → Контент сайта → Правовая информация.

   Редактор устроен так же, как «О проекте»: текст по умолчанию показывается
   плейсхолдером, а в базу уходит только то, что администратор действительно
   изменил. Пустое поле стирает переопределение и возвращает текст из кода. */

interface FieldDef {
  key: string;
  label: string;
  def: string;
  rows?: number;
}

const HEAD_FIELDS: FieldDef[] = [
  { key: legalKeys.heading, label: "Заголовок документа", def: LEGAL_DEFAULTS.heading },
  { key: legalKeys.subheading, label: "Подзаголовок (редакция, дата)", def: LEGAL_DEFAULTS.subheading },
  {
    key: legalKeys.preamble,
    label: "Преамбула (оферта)",
    def: "Пусто — на сайте остаётся текст оферты по умолчанию",
    rows: 6,
  },
];

/* Опубликованные почты. Раньше адреса жили только в разметке /about
   (один legal@trioz.ru), поэтому медийной и сервисной почты на сайте не было,
   а правка требовала изменения кода. Теперь это настройки siteConfig. */
const CONTACT_FIELDS: FieldDef[] = [
  ...LEGAL_CONTACTS.flatMap((c) => [
    {
      key: legalKeys.contactLabel(c.key),
      label: `Название канала «${c.label}»`,
      def: c.label,
    },
    {
      key: legalKeys.contactEmail(c.key),
      label: `Почта — ${c.label} (${c.hint})`,
      def: c.email,
    },
  ]),
  {
    key: legalKeys.contactUrl,
    label: "Адрес сайта в контактах",
    def: LEGAL_DEFAULTS.contactUrl,
  },
];

const ALL_KEYS = [
  ...HEAD_FIELDS.map((f) => f.key),
  ...CONTACT_FIELDS.map((f) => f.key),
  ...LEGAL_SECTIONS.flatMap((_s, i) => [legalKeys.sectionTitle(i), legalKeys.sectionContent(i)]),
];

export default function AdminLegalPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [values, setValues] = useState<Record<string, string>>({});
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  /* Текст, который сейчас показывается на сайте из старого блока
     «Правовая информация» (таблица AboutBlock). Без этого редактор
     выглядел пустым, хотя на /about текст есть. */
  const [legacy, setLegacy] = useState<Record<string, string>>({});

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") router.push("/");
  }, [session, status, router]);

  useEffect(() => {
    fetch("/api/about-blocks")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ type?: string; data?: unknown }>) => {
        const row = Array.isArray(rows) ? rows.find((b) => b?.type === "legal") : null;
        setLegacy(legacyLegalOverrides(row?.data));
      })
      .catch(() => setLegacy({}));
  }, []);

  useEffect(() => {
    fetch("/api/site-content")
      .then((r) => r.json())
      .then((data: Record<string, string>) => {
        const next: Record<string, string> = {};
        for (const k of ALL_KEYS) next[k] = data?.[k] ?? "";
        setValues(next);
        setInitial(next);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const dirty = useMemo(
    () => ALL_KEYS.some((k) => (values[k] ?? "") !== (initial[k] ?? "")),
    [values, initial],
  );

  const set = (key: string, v: string) => setValues((p) => ({ ...p, [key]: v }));

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const save = async () => {
    setSaving(true);
    try {
      const changed = ALL_KEYS.filter((k) => (values[k] ?? "") !== (initial[k] ?? ""));
      for (const key of changed) {
        const value = (values[key] ?? "").trim();
        if (value) {
          await fetch("/api/site-content", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key, value }),
          });
        } else {
          await fetch("/api/site-content", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key }),
          });
        }
      }
      setInitial({ ...values });
      showToast("Правовая информация сохранена", "success");
    } catch {
      showToast("Не удалось сохранить", "error");
    } finally {
      setSaving(false);
    }
  };

  const field = (f: FieldDef) => {
    const fromBlock = (legacy[f.key] ?? "").trim();
    const placeholder = fromBlock || f.def;

    return (
    <div key={f.key} className="space-y-1.5">
      <label className="block text-xs font-medium text-gray-400">{f.label}</label>
      {f.rows ? (
        <textarea
          value={values[f.key] ?? ""}
          onChange={(e) => set(f.key, e.target.value)}
          rows={f.rows}
          placeholder={placeholder}
          className="input-field w-full font-mono text-xs leading-relaxed"
        />
      ) : (
        <input
          value={values[f.key] ?? ""}
          onChange={(e) => set(f.key, e.target.value)}
          placeholder={placeholder}
          className="input-field w-full"
        />
      )}
      {!(values[f.key] ?? "").trim() && (
        <p className="text-[11px] text-gray-600">
          {fromBlock
            ? "Пусто — на сайте показывается текст из старого блока (виден в поле серым)."
            : "Пусто — на сайте показывается текст по умолчанию."}
        </p>
      )}
    </div>
    );
  };

  if (loading || status === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 pb-28">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-widest text-gray-500">Контент сайта</p>
        <h1 className="text-2xl font-semibold text-white">Правовая информация</h1>
        <p className="mt-1 text-sm text-gray-400">
          Пользовательское соглашение, которое открывается на странице{" "}
          <Link href="/about" className="text-accent hover:underline">
            /about
          </Link>
          .
        </p>
      </div>

      <div className="glass-card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-white">Шапка документа</h2>
        {HEAD_FIELDS.map(field)}
      </div>

      <div className="mt-5 glass-card space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold text-white">Опубликованные почты</h2>
          <p className="mt-1 text-xs text-gray-500">
            Показываются дважды на /about: подписанным списком в блоке
            правовой информации и короткими ссылками в самом низу страницы.
          </p>
        </div>
        {CONTACT_FIELDS.map(field)}
      </div>

      <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-gray-400">
        🧱 Этот раздел и «О проекте» — независимые источники и оба видны на{" "}
        <Link href="/about" className="text-accent hover:underline">
          /about
        </Link>
        : блоки из{" "}
        <Link href="/admin/content" className="text-accent hover:underline">
          О проекте
        </Link>{" "}
        рисуются в теле страницы, а текст соглашения и почты с этой страницы —
        в подвале. Один раздел не отключает другой.
      </div>

      <div className="mt-5 space-y-2">
        {LEGAL_SECTIONS.map((s, i) => {
          const titleKey = legalKeys.sectionTitle(i);
          const contentKey = legalKeys.sectionContent(i);
          const open = openIdx === i;
          return (
            <div key={titleKey} className="glass-card overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenIdx(open ? null : i)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="min-w-0 truncate text-sm text-white">
                  {(values[titleKey] ?? "").trim() ||
                    (legacy[titleKey] ?? "").trim() ||
                    s.title}
                </span>
                <span className="shrink-0 text-xs text-gray-500">{open ? "свернуть" : "править"}</span>
              </button>
              {open && (
                <div className="space-y-4 border-t border-white/5 px-4 py-4">
                  {field({ key: titleKey, label: "Заголовок раздела", def: s.title })}
                  {field({ key: contentKey, label: "Текст раздела", def: s.content, rows: 14 })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-dark-900/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <span className="text-xs text-gray-500">
            {dirty ? "Есть несохранённые изменения" : "Все изменения сохранены"}
          </span>
          <button onClick={save} disabled={!dirty || saving} className="btn-primary disabled:opacity-50">
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={`fixed bottom-20 right-6 z-50 rounded-xl px-5 py-3 text-sm font-medium text-white shadow-lg ${
              toast.type === "success" ? "bg-green-500" : "bg-red-500"
            }`}
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
