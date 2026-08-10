"use client";

import { useSession } from "next-auth/react";
import Spinner from "@/components/ui/Spinner";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import ImageInput from "@/components/admin/ImageInput";
import InfoTooltip from "@/components/ui/InfoTooltip";

interface WindowConfig {
  id: string;
  windowKey: string;
  title: string;
  subtitle: string;
  description: string;
  href: string;
  accentColor: string;
  backgroundUrl: string | null;
  backgroundType: string;
  gradientFrom: string;
  gradientTo: string;
  order: number;
  active: boolean;
}

export default function AdminWindowsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [windows, setWindows] = useState<WindowConfig[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<WindowConfig>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (status === "authenticated" && (session?.user as { role?: string })?.role !== "ADMIN") {
      router.push("/");
    }
  }, [session, status, router]);

  const fetchWindows = async () => {
    const res = await fetch("/api/windows");
    setWindows(await res.json());
  };

  useEffect(() => {
    if ((session?.user as { role?: string })?.role === "ADMIN") fetchWindows();
  }, [session]);

  const startEdit = (win: WindowConfig) => {
    setEditing(win.id);
    setForm({ ...win });
  };

  const cancelEdit = () => {
    setEditing(null);
    setForm({});
  };

  const saveWindow = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await fetch("/api/windows", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editing, ...form }),
      });
      await fetchWindows();
      setEditing(null);
      setForm({});
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-dark-900">
        <Spinner />
      </div>
    );
  }

  if ((session?.user as { role?: string })?.role !== "ADMIN") return null;

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
            <h1 className="text-2xl font-bold text-white">Управление окнами главной</h1>
            <p className="text-gray-400 text-sm mt-1">Настраивайте фоны, цвета и контент 4 окон главной страницы</p>
          </div>
        </div>

        <div className="space-y-4">
          {windows.map((win, i) => (
            <motion.div
              key={win.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="glass-card overflow-hidden"
            >
              {editing === win.id ? (
                <div className="p-6 space-y-4">
                  <h3 className="text-lg font-bold text-white mb-4">
                    Редактирование: {win.title}
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Название</label>
                      <input
                        type="text"
                        value={form.title || ""}
                        onChange={(e) => setForm({ ...form, title: e.target.value })}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Подзаголовок</label>
                      <input
                        type="text"
                        value={form.subtitle || ""}
                        onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
                        className="input-field"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Описание</label>
                    <textarea
                      value={form.description || ""}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      className="input-field h-20 resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Ссылка</label>
                      <input
                        type="text"
                        value={form.href || ""}
                        onChange={(e) => setForm({ ...form, href: e.target.value })}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Акцентный цвет</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={form.accentColor || "#ff4444"}
                          onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
                          className="w-10 h-10 rounded-lg border border-white/10 cursor-pointer bg-transparent"
                        />
                        <input
                          type="text"
                          value={form.accentColor || ""}
                          onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
                          className="input-field flex-1"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Тип фона</label>
                      <select
                        value={form.backgroundType || "gradient"}
                        onChange={(e) => setForm({ ...form, backgroundType: e.target.value })}
                        className="input-field"
                      >
                        <option value="gradient">Градиент</option>
                        <option value="video">Видео (анимация)</option>
                        <option value="image">Изображение</option>
                      </select>
                    </div>
                  </div>

                  {form.backgroundType === "gradient" && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm text-gray-400 mb-1">Градиент: начало</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={form.gradientFrom || "#1a0000"}
                            onChange={(e) => setForm({ ...form, gradientFrom: e.target.value })}
                            className="w-10 h-10 rounded-lg border border-white/10 cursor-pointer bg-transparent"
                          />
                          <input
                            type="text"
                            value={form.gradientFrom || ""}
                            onChange={(e) => setForm({ ...form, gradientFrom: e.target.value })}
                            className="input-field flex-1"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm text-gray-400 mb-1">Градиент: конец</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={form.gradientTo || "#0a0a0f"}
                            onChange={(e) => setForm({ ...form, gradientTo: e.target.value })}
                            className="w-10 h-10 rounded-lg border border-white/10 cursor-pointer bg-transparent"
                          />
                          <input
                            type="text"
                            value={form.gradientTo || ""}
                            onChange={(e) => setForm({ ...form, gradientTo: e.target.value })}
                            className="input-field flex-1"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {(form.backgroundType === "video" || form.backgroundType === "image") && (
                    <div>
                      {form.backgroundType === "image" ? (
                        <ImageInput
                          label="Изображение фона"
                          value={form.backgroundUrl || ""}
                          onChange={(url) => setForm({ ...form, backgroundUrl: url })}
                          uploadDir="windows"
                          placeholder="https://... или загрузите файл"
                        />
                      ) : (
                        <>
                          <label className="block text-sm text-gray-400 mb-1">
                            URL видео{" "}
                            <InfoTooltip text="Подойдут MP4 и WebM. На странице такое видео крутится по кругу и всегда без звука." />
                          </label>
                          <input
                            type="text"
                            value={form.backgroundUrl || ""}
                            onChange={(e) => setForm({ ...form, backgroundUrl: e.target.value })}
                            className="input-field"
                            placeholder="https://example.com/bg.mp4"
                          />
                        </>
                      )}
                    </div>
                  )}

                  {/* Preview */}
                  <div className="mt-4">
                    <label className="block text-sm text-gray-400 mb-2">Превью</label>
                    <div
                      className="h-32 rounded-xl overflow-hidden relative"
                      style={{
                        background: form.backgroundType === "gradient"
                          ? `linear-gradient(135deg, ${form.gradientFrom} 0%, ${form.gradientTo} 100%)`
                          : "#0a0a0f",
                      }}
                    >
                      {form.backgroundType === "image" && form.backgroundUrl && (
                        <div
                          className="absolute inset-0 bg-cover bg-center"
                          style={{ backgroundImage: `url(${form.backgroundUrl})` }}
                        />
                      )}
                      <div className="absolute inset-0 bg-black/40" />
                      <div className="relative z-10 p-4 flex flex-col justify-end h-full">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: form.accentColor }} />
                          <span className="text-xs" style={{ color: form.accentColor }}>{form.subtitle}</span>
                        </div>
                        <h4 className="text-white font-bold">{form.title}</h4>
                        <p className="text-gray-400 text-xs">{form.description}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3 justify-end pt-2">
                    <button onClick={cancelEdit} className="btn-secondary text-sm !px-4 !py-2">
                      Отмена
                    </button>
                    <button onClick={saveWindow} disabled={saving} className="btn-primary text-sm !px-6 !py-2">
                      {saving ? "Сохранение..." : "Сохранить"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4 p-4">
                  {/* Color preview */}
                  <div
                    className="w-16 h-16 rounded-xl flex-shrink-0"
                    style={{
                      background: `linear-gradient(135deg, ${win.gradientFrom} 0%, ${win.gradientTo} 100%)`,
                      border: `2px solid ${win.accentColor}30`,
                    }}
                  >
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: win.accentColor, boxShadow: `0 0 8px ${win.accentColor}60` }} />
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-white font-semibold">{win.title}</h3>
                      <span className="text-xs px-2 py-0.5 rounded-full border" style={{ color: win.accentColor, borderColor: `${win.accentColor}30` }}>
                        {win.backgroundType}
                      </span>
                    </div>
                    <p className="text-gray-400 text-sm truncate">{win.description}</p>
                    <p className="text-gray-600 text-xs mt-1">
                      Ключ: {win.windowKey} | Ссылка: {win.href}
                    </p>
                  </div>

                  <button
                    onClick={() => startEdit(win)}
                    className="btn-secondary text-sm !px-4 !py-2 flex-shrink-0"
                  >
                    Редактировать
                  </button>
                </div>
              )}
            </motion.div>
          ))}
        </div>

        {windows.length === 0 && (
          <div className="text-center py-16 text-gray-500">
            <p>Окна не настроены. Запустите seed для создания стандартных окон.</p>
          </div>
        )}
      </div>
    </div>
  );
}
