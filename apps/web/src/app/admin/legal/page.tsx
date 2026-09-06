"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LEGAL_CONTACTS, LEGAL_DEFAULTS, LEGAL_SECTIONS, legalKeys, resolveLegalContent, type LegalContent } from "@/lib/legal";

const inputCls = "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder-neutral-600 focus:border-indigo-500/50 focus:outline-none";

export default function AdminLegalPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [content, setContent] = useState<LegalContent>(resolveLegalContent());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (session?.user?.role !== "ADMIN") {
      router.replace("/");
      return;
    }
    fetch("/api/site-content", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => setContent(resolveLegalContent(data)))
      .catch(() => setMessage("Не удалось загрузить сохранённые данные"))
      .finally(() => setLoading(false));
  }, [router, session, status]);

  const defaults = useMemo(() => resolveLegalContent(), []);

  const update = <K extends keyof LegalContent>(key: K, value: LegalContent[K]) =>
    setContent((prev) => ({ ...prev, [key]: value }));

  const saveValue = async (key: string, value: string) => {
    if (value.trim()) {
      const r = await fetch("/api/site-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      if (!r.ok) throw new Error(key);
    } else {
      const r = await fetch("/api/site-content", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!r.ok) throw new Error(key);
    }
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const tasks: Promise<void>[] = [
        saveValue(legalKeys.heading, content.heading === defaults.heading ? "" : content.heading),
        saveValue(legalKeys.subheading, content.subheading === defaults.subheading ? "" : content.subheading),
        saveValue(legalKeys.preamble, content.preamble === defaults.preamble ? "" : content.preamble),
        saveValue(legalKeys.contactUrl, content.contactUrl === defaults.contactUrl ? "" : content.contactUrl),
      ];

      await Promise.all(tasks);

      const maxSections = Math.max(content.sections.length, defaults.sections.length);
      for (let i = 0; i < maxSections; i++) {
        const sec = content.sections[i];
        await Promise.all([
          saveValue(legalKeys.sectionTitle(i), sec?.title && sec.title !== defaults.sections[i]?.title ? sec.title : ""),
          saveValue(legalKeys.sectionContent(i), sec?.content && sec.content !== defaults.sections[i]?.content ? sec.content : ""),
        ]);
      }

      const maxContacts = Math.max(content.contacts.length, LEGAL_CONTACTS.length);
      for (let i = 0; i < maxContacts; i++) {
        const base = content.contacts[i];
        const fallback = defaults.contacts[i];
        if (!base) continue;
        await Promise.all([
          saveValue(legalKeys.contactLabel(base.key), base.label !== fallback?.label ? base.label : ""),
          saveValue(legalKeys.contactEmail(base.key), base.email !== fallback?.email ? base.email : ""),
          saveValue(legalKeys.contactHint(base.key), base.hint !== fallback?.hint ? base.hint : ""),
        ]);
      }

      setMessage("Изменения сохранены. Они сразу отображаются на /about.");
    } catch {
      setMessage("Не удалось сохранить все изменения. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      setSaving(false);
    }
  };

  const addSection = () => setContent((prev) => ({ ...prev, sections: [...prev.sections, { title: "Новый раздел", content: "" }] }));
  const removeSection = (i: number) => setContent((prev) => ({ ...prev, sections: prev.sections.filter((_, j) => j !== i) }));
  const addContact = () => setContent((prev) => ({ ...prev, contacts: [...prev.contacts, { key: `contact${Date.now()}`, label: "Новый канал", hint: "", email: "" }] }));
  const removeContact = (i: number) => setContent((prev) => ({ ...prev, contacts: prev.contacts.filter((_, j) => j !== i) }));

  if (status === "loading" || loading) return <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-neutral-500">Загрузка…</div>;
  if (session?.user?.role !== "ADMIN") return null;

  return (
    <div className="min-h-screen bg-neutral-950 text-white px-4 py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <Link href="/admin" className="text-sm text-indigo-400 hover:text-indigo-300">← Админ-панель</Link>
            <h1 className="mt-3 text-2xl font-bold">Правовая информация</h1>
            <p className="mt-1 text-sm text-neutral-500">Единственный редактор пользовательского соглашения и контактных данных для /about.</p>
          </div>
          <Link href="/about" target="_blank" className="rounded-xl border border-white/10 px-4 py-2 text-sm text-neutral-300 hover:bg-white/5">Открыть /about</Link>
        </div>

        {message && <div className="mb-6 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-3 text-sm text-indigo-200">{message}</div>}

        <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
          <h2 className="mb-5 text-lg font-semibold">Основные данные</h2>
          <label className="mb-4 block"><span className="mb-1 block text-xs uppercase tracking-widest text-neutral-500">Заголовок</span><input className={inputCls} value={content.heading} onChange={(e) => update("heading", e.target.value)} /></label>
          <label className="mb-4 block"><span className="mb-1 block text-xs uppercase tracking-widest text-neutral-500">Редакция / дата</span><input className={inputCls} value={content.subheading} onChange={(e) => update("subheading", e.target.value)} /></label>
          <label className="mb-4 block"><span className="mb-1 block text-xs uppercase tracking-widest text-neutral-500">Вступление</span><textarea className={inputCls + " min-h-40 resize-y"} value={content.preamble} onChange={(e) => update("preamble", e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-xs uppercase tracking-widest text-neutral-500">Адрес сайта</span><input className={inputCls} value={content.contactUrl} onChange={(e) => update("contactUrl", e.target.value)} /></label>
        </section>

        <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
          <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Разделы соглашения</h2><button type="button" onClick={addSection} className="text-sm text-indigo-400">+ Добавить</button></div>
          <div className="space-y-4">
            {content.sections.map((section, i) => (
              <div key={i} className="rounded-xl border border-white/10 p-4">
                <div className="mb-3 flex items-center justify-between gap-3"><span className="text-sm font-semibold">Раздел {i + 1}</span><button type="button" onClick={() => removeSection(i)} className="text-sm text-red-400">Удалить</button></div>
                <input className={inputCls + " mb-3"} value={section.title} onChange={(e) => setContent((p) => ({ ...p, sections: p.sections.map((x, j) => j === i ? { ...x, title: e.target.value } : x) }))} />
                <textarea className={inputCls + " min-h-48 resize-y"} value={section.content} onChange={(e) => setContent((p) => ({ ...p, sections: p.sections.map((x, j) => j === i ? { ...x, content: e.target.value } : x) }))} />
              </div>
            ))}
          </div>
        </section>

        <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
          <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Контакты администрации</h2><button type="button" onClick={addContact} className="text-sm text-indigo-400">+ Добавить</button></div>
          <div className="space-y-4">
            {content.contacts.map((contact, i) => (
              <div key={contact.key} className="rounded-xl border border-white/10 p-4">
                <div className="mb-3 flex items-center justify-between gap-3"><span className="text-sm font-semibold">{contact.label || "Канал"}</span><button type="button" onClick={() => removeContact(i)} className="text-sm text-red-400">Удалить</button></div>
                <div className="grid gap-3 md:grid-cols-2">
                  <input className={inputCls} placeholder="Название" value={contact.label} onChange={(e) => setContent((p) => ({ ...p, contacts: p.contacts.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))} />
                  <input className={inputCls} placeholder="email@example.com" value={contact.email} onChange={(e) => setContent((p) => ({ ...p, contacts: p.contacts.map((x, j) => j === i ? { ...x, email: e.target.value } : x) }))} />
                </div>
                <input className={inputCls + " mt-3"} placeholder="По каким вопросам писать" value={contact.hint} onChange={(e) => setContent((p) => ({ ...p, contacts: p.contacts.map((x, j) => j === i ? { ...x, hint: e.target.value } : x) }))} />
              </div>
            ))}
          </div>
        </section>

        <div className="sticky bottom-4 mt-6 flex justify-end">
          <button type="button" disabled={saving} onClick={save} className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-xl hover:bg-indigo-500 disabled:opacity-50">{saving ? "Сохранение…" : "Сохранить изменения"}</button>
        </div>
      </div>
    </div>
  );
}
