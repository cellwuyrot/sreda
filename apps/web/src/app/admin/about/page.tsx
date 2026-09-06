"use client";

import { useSession } from "next-auth/react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import Spinner from "@/components/ui/Spinner";
import InfoTooltip from "@/components/ui/InfoTooltip";
import ProjectGlyph from "@/components/about/ProjectGlyph";
import { ABOUT_SECTIONS, ABOUT_DEFAULTS, aboutKeys } from "@/lib/about";

/* ─── Field descriptors: one entry per editable content key ─── */
interface FieldDef {
  key: string;
  label: string;
  def: string;
  multiline?: boolean;
}

interface FieldGroup {
  title: string;
  subtitle?: string;
  color?: string;
  glyph?: string;
  fields: FieldDef[];
}

const GROUPS: FieldGroup[] = [
  {
    title: "Шапка раздела",
    subtitle: "Верхний блок страницы «О проекте» — надзаголовок, крупный заголовок и описание.",
    fields: [
      { key: aboutKeys.eyebrow, label: "Надзаголовок", def: ABOUT_DEFAULTS.eyebrow },
      { key: aboutKeys.title, label: "Заголовок", def: ABOUT_DEFAULTS.title },
      { key: aboutKeys.subtitle, label: "Подзаголовок", def: ABOUT_DEFAULTS.subtitle, multiline: true },
    ],
  },
  ...ABOUT_SECTIONS.map((s) => ({
    title: s.title,
    subtitle: `Блок экосистемы · ${s.href}`,
    color: s.color,
    glyph: s.key,
    fields: [
      { key: aboutKeys.sectionTitle(s.key), label: "Заголовок блока", def: s.title },
      { key: aboutKeys.sectionDesc(s.key), label: "Описание блока", def: s.description, multiline: true },
    ],
  })),
  {
    title: "Подвал",
    fields: [{ key: aboutKeys.footer, label: "Текст в подвале", def: ABOUT_DEFAULTS.footer }],
  },
];

const ALL_KEYS = GROUPS.flatMap((g) => g.fields.map((f) => f.key));

function Toast({ message, type }: { message: string; type: "success" | "error" }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className={`fixed bottom-6 right-6 z-50 rounded-xl px-5 py-3 text-sm font-medium text-white shadow-lg ${
        type === "success" ? "bg-green-500" : "bg-red-500"
      }`}
    >
      {message}
    </motion.div>
  );
}

export default function AdminAboutPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Overrides currently stored, and the working form values (override or "").
  const [values, setValues] = useState<Record<string, string>>({});
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") router.push("/");
  }, [session, status, router]);

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

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const dirty = useMemo(
    () => ALL_KEYS.some((k) => (values[k] ?? "") !== (initial[k] ?? "")),
    [values, initial],
  );

  const set = (key: string, v: string) => setValues((p) => ({ ...p, [key]: v }));

  const save = async () => {
    setSaving(true);
    try {
      // Persist only what changed. Empty value ⇒ remove the override (reset to default).
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
      showToast("Изменения сохранены", "success");
    } catch {
      showToast("Не удалось сохранить", "error");
    } finally {
      setSaving(false);
    }
  };

  const resetAll = async () => {
    if (!(await confirmDialog({ message: "Сбросить весь контент раздела «О проекте» к значениям по умолчанию?", confirmText: "Сбросить", danger: true }))) return;
    setSaving(true);
    try {
      for (const key of ALL_KEYS) {
        await fetch("/api/site-content", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key }),
        });
      }
      const cleared: Record<string, string> = {};
      for (const k of ALL_KEYS) cleared[k] = "";
      setValues(cleared);
      setInitial(cleared);
      showToast("Контент сброшен к значениям по умолчанию", "success");
    } catch {
      showToast("Не удалось сбросить", "error");
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading" || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <Spinner />
      </div>
    );
  }
  if (session?.user?.role !== "ADMIN") return null;

  const inputClass =
    "w-full rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-4 py-2.5 text-sm text-neutral-900 dark:text-white placeholder-neutral-400 transition-colors focus:border-violet-500 dark:focus:border-cyan-500 focus:outline-none";

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 px-4 pb-28 pt-8">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-6">
          <Link href="/admin" className="mb-2 inline-flex items-center gap-1 text-sm text-violet-600 dark:text-cyan-400 transition-colors hover:opacity-80">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Админ-панель
          </Link>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">
            Раздел «О проекте»{" "}
            <InfoTooltip
              side="bottom"
              text="Пустое поле — значит, останется текст по умолчанию: он подсказан серым прямо в поле. Те же самые тексты можно править и на самой странице, если включить режим редактирования сайта."
            />
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-gray-400">
            Тексты страницы{" "}
            <Link href="/about" className="text-violet-600 dark:text-cyan-400 hover:underline">/about</Link>.
          </p>
        </div>

        {/* Groups */}
        <div className="space-y-5">
          {GROUPS.map((group) => (
            <div
              key={group.title}
              className="space-y-4 rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 p-6"
            >
              <div className="flex items-center gap-3">
                {group.glyph && (
                  <span
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border"
                    style={{ color: group.color, borderColor: `${group.color}40`, backgroundColor: `${group.color}14` }}
                  >
                    <ProjectGlyph name={group.glyph} className="h-6 w-6" />
                  </span>
                )}
                <div>
                  <h2 className="text-base font-semibold text-neutral-900 dark:text-white">{group.title}</h2>
                  {group.subtitle && <p className="mt-0.5 text-xs text-neutral-500 dark:text-gray-400">{group.subtitle}</p>}
                </div>
              </div>

              {group.fields.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <label className="block text-sm text-neutral-500 dark:text-gray-400">{f.label}</label>
                  {f.multiline ? (
                    <textarea
                      value={values[f.key] ?? ""}
                      onChange={(e) => set(f.key, e.target.value)}
                      placeholder={f.def}
                      rows={3}
                      className={`${inputClass} resize-y`}
                    />
                  ) : (
                    <input
                      type="text"
                      value={values[f.key] ?? ""}
                      onChange={(e) => set(f.key, e.target.value)}
                      placeholder={f.def}
                      className={inputClass}
                    />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={resetAll}
            disabled={saving}
            className="text-sm text-neutral-500 transition-colors hover:text-red-500 disabled:opacity-50"
          >
            Сбросить всё к значениям по умолчанию
          </button>
        </div>
      </div>

      {/* Sticky save bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 dark:border-white/10 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <span className="text-xs text-neutral-500 dark:text-gray-400">
            {dirty ? "Есть несохранённые изменения" : "Все изменения сохранены"}
          </span>
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="rounded-xl bg-violet-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50 dark:bg-cyan-600 dark:hover:bg-cyan-500"
          >
            {saving ? "Сохранение…" : "Сохранить изменения"}
          </button>
        </div>
      </div>

      <AnimatePresence>{toast && <Toast message={toast.message} type={toast.type} />}</AnimatePresence>
    </div>
  );
}
