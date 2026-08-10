"use client";

import { useSession } from "next-auth/react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import Spinner from "@/components/ui/Spinner";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import ImageInput from "@/components/admin/ImageInput";

interface EcosystemItem {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  linkUrl: string | null;
  section: string;
  order: number;
  active: boolean;
}

export default function AdminEcosystemPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [items, setItems] = useState<EcosystemItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: "", description: "", imageUrl: "", linkUrl: "", section: "", order: 0,
  });

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") {
      router.push("/");
    }
  }, [session, status, router]);

  const fetchItems = async () => {
    const res = await fetch("/api/ecosystem");
    setItems(await res.json());
  };

  useEffect(() => {
    if (session?.user?.role === "ADMIN") fetchItems();
  }, [session]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch("/api/ecosystem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ title: "", description: "", imageUrl: "", linkUrl: "", section: "", order: 0 });
    setShowForm(false);
    fetchItems();
  };

  const toggleActive = async (item: EcosystemItem) => {
    await fetch("/api/ecosystem", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, active: !item.active }),
    });
    fetchItems();
  };

  const deleteItem = async (id: string) => {
    if (!(await confirmDialog({ message: "Удалить элемент?", confirmText: "Удалить", danger: true }))) return;
    await fetch("/api/ecosystem", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchItems();
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-dark-900">
        <Spinner />
      </div>
    );
  }

  if (session?.user?.role !== "ADMIN") return null;

  const sections = Array.from(new Set(items.map((i) => i.section)));

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-dark-900 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/admin" className="text-cyan-400 hover:text-cyan-300 text-sm mb-2 inline-flex items-center gap-1 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Админ-панель
            </Link>
            <h1 className="text-2xl font-bold text-white">Управление экосистемой</h1>
            <p className="text-gray-400 text-sm mt-1">Добавляйте новые элементы и разделы в экосистему TrioZ</p>
          </div>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary text-sm">
            {showForm ? "Отмена" : "Добавить элемент"}
          </button>
        </div>

        {showForm && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-6 mb-8"
          >
            <h3 className="text-lg font-bold text-white mb-4">Новый элемент экосистемы</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Название</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Раздел</label>
                  <input
                    type="text"
                    value={form.section}
                    onChange={(e) => setForm({ ...form, section: e.target.value })}
                    className="input-field"
                    placeholder="Проекты, Услуги, Игры..."
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Описание</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="input-field min-h-[100px]"
                  required
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <ImageInput
                    label="Изображение"
                    value={form.imageUrl}
                    onChange={(url) => setForm({ ...form, imageUrl: url })}
                    uploadDir="ecosystem"
                    placeholder="https://... или загрузите файл"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Ссылка</label>
                  <input
                    type="text"
                    value={form.linkUrl}
                    onChange={(e) => setForm({ ...form, linkUrl: e.target.value })}
                    className="input-field"
                    placeholder="https://..."
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Порядок</label>
                  <input
                    type="number"
                    value={form.order}
                    onChange={(e) => setForm({ ...form, order: parseInt(e.target.value) })}
                    className="input-field"
                  />
                </div>
              </div>
              <button type="submit" className="btn-primary">Создать</button>
            </form>
          </motion.div>
        )}

        {sections.length > 0 ? (
          sections.map((section) => (
            <div key={section} className="mb-8">
              <h3 className="text-lg font-bold text-white mb-3">{section}</h3>
              <div className="space-y-3">
                {items
                  .filter((item) => item.section === section)
                  .map((item, i) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className={`glass-card p-4 flex items-start gap-4 ${!item.active ? "opacity-50" : ""}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white">{item.title}</span>
                          <span className="text-xs text-gray-500">#{item.order}</span>
                        </div>
                        <p className="text-gray-400 text-sm mt-1">{item.description}</p>
                        {item.linkUrl && (
                          <a href={item.linkUrl} className="text-cyan-400 text-xs mt-1 inline-block hover:underline">
                            {item.linkUrl}
                          </a>
                        )}
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => toggleActive(item)}
                          className={`px-3 py-1 rounded-lg text-xs transition-all ${
                            item.active ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                          }`}
                        >
                          {item.active ? "Активен" : "Скрыт"}
                        </button>
                        <button
                          onClick={() => deleteItem(item.id)}
                          className="p-1 text-gray-500 hover:text-red-400 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </motion.div>
                  ))}
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-16 text-gray-500">
            <span className="text-4xl block mb-3">🌐</span>
            <p>Нет элементов экосистемы. Добавьте первый!</p>
          </div>
        )}
      </div>
    </div>
  );
}
