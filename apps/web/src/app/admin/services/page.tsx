"use client";

import { useSession } from "next-auth/react";
import Spinner from "@/components/ui/Spinner";
import Input from "@/components/ui/Input";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import Image from "next/image";

import { useAdminBackHref } from "@/components/admin/useAdminBackHref"; // FIX-EDR2
// STAGES: шестерёнка рядом с карандашом открывает этапы работ по этой услуге.
// Именно они показываются заказчику в личном кабинете (см. lib/orderStages.ts).
import ServiceStagesModal from "@/components/admin/ServiceStagesModal";
// BUSINESS-PAY: вторая кнопка рядом — договоры и приложения к этой услуге.
// Они подтягиваются в форму оплаты делового чата и видны клиенту только там.
import ServiceDocumentsModal from "@/components/admin/ServiceDocumentsModal";
import { GearIcon } from "@/components/ui/ConnectIcons";

interface Service {
  id: string;
  title: string;
  description: string;
  icon: string | null;
  order: number;
  active: boolean;
}

/* ── Toggle switch ── */
function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      aria-checked={checked}
      role="switch"
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
        checked ? "bg-green-500" : "bg-neutral-600"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

/* ── Icon preview ── */
function ServiceIcon({ icon, size = 40 }: { icon: string | null; size?: number }) {
  if (!icon) return <span className="text-2xl">🔹</span>;
  if (icon.startsWith("/")) {
    return (
      <Image
        src={icon}
        alt="icon"
        width={size}
        height={size}
        className="rounded object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return <span className="text-2xl">{icon}</span>;
}

/* ── Edit modal ── */
function EditModal({
  service,
  onClose,
  onSaved,
}: {
  service: Service;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title: service.title,
    description: service.description,
    icon: service.icon || "",
    order: service.order,
  });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [iconPreview, setIconPreview] = useState<string | null>(service.icon);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);

    // Client-side size check
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
      setUploadError("Только PNG, JPG, WebP или GIF");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadError("Файл слишком большой (макс. 2MB)");
      return;
    }

    // Show preview immediately
    const reader = new FileReader();
    reader.onload = (ev) => setIconPreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    // Upload
    setUploading(true);
    const fd = new FormData();
    fd.append("icon", file);
    const res = await fetch("/api/services/icon", { method: "POST", body: fd });
    const data = await res.json();
    setUploading(false);

    if (!res.ok) {
      setUploadError(data.error || "Ошибка загрузки");
      setIconPreview(service.icon);
      return;
    }
    setForm((f) => ({ ...f, icon: data.url }));
    setIconPreview(data.url);
  };

  const handleSave = async () => {
    setSaving(true);
    await fetch("/api/services", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: service.id, ...form }),
    });
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-neutral-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-white">Редактировать услугу</h3>

        {/* Icon upload */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">Иконка (256×256, PNG/JPG/WebP/GIF)</label>
          <div className="flex items-center gap-4">
            {/* Preview */}
            <div className="w-16 h-16 rounded-xl border border-white/10 bg-white/5 flex items-center justify-center flex-shrink-0 overflow-hidden">
              {iconPreview ? (
                iconPreview.startsWith("/") || iconPreview.startsWith("data:") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={iconPreview} alt="preview" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl">{iconPreview}</span>
                )
              ) : (
                <span className="text-gray-600 text-xs text-center">нет иконки</span>
              )}
            </div>

            <div className="flex-1 space-y-2">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-full px-3 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
              >
                {uploading ? "Загрузка..." : "Загрузить изображение"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={handleFileChange}
                className="hidden"
              />
              <p className="text-xs text-gray-500">Или введите emoji:</p>
              <input
                type="text"
                value={form.icon.startsWith("/") ? "" : form.icon}
                onChange={(e) => {
                  setForm((f) => ({ ...f, icon: e.target.value }));
                  setIconPreview(e.target.value);
                }}
                placeholder="🔧"
                maxLength={8}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>
          {uploadError && <p className="text-red-400 text-xs mt-1">{uploadError}</p>}
        </div>

        {/* Title */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">Название</label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">Описание</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={3}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500 resize-none"
          />
        </div>

        {/* Order */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">Порядок</label>
          <input
            type="number"
            value={form.order}
            onChange={(e) => setForm((f) => ({ ...f, order: parseInt(e.target.value) || 0 }))}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-white/10 hover:bg-white/15 text-white rounded-lg text-sm transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? "Сохранение..." : "Сохранить"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/* ── Main page ── */
export default function AdminServicesPage() {
  // FIX-EDR2: редактору «Назад» ведёт в «Редакторскую», админу — в админку
  const backHref = useAdminBackHref();
  const { data: session, status } = useSession();
  const router = useRouter();
  const [services, setServices] = useState<Service[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  /** STAGES: услуга, у которой сейчас правят этапы работ. */
  const [stagesService, setStagesService] = useState<Service | null>(null);
  // BUSINESS-PAY: открытая карточка документов услуги (шаблоны договоров).
  const [docsService, setDocsService] = useState<Service | null>(null);
  const [form, setForm] = useState({ title: "", description: "", icon: "", order: 0 });
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN" && session?.user?.role !== "EDITOR") {
      router.push("/");
    }
  }, [session, status, router]);

  const fetchServices = async () => {
    // Pass all=true to get both active and inactive services
    const res = await fetch("/api/services?all=true");
    setServices(await res.json());
  };

  useEffect(() => {
    if ((session?.user?.role === "ADMIN" || session?.user?.role === "EDITOR")) fetchServices();
  }, [session]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch("/api/services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ title: "", description: "", icon: "", order: 0 });
    setShowForm(false);
    fetchServices();
  };

  const toggleActive = async (service: Service) => {
    setTogglingId(service.id);
    await fetch("/api/services", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: service.id, active: !service.active }),
    });
    setTogglingId(null);
    fetchServices();
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-dark-900">
        <Spinner />
      </div>
    );
  }

  if (session?.user?.role !== "ADMIN" && session?.user?.role !== "EDITOR") return null;

  const active = services.filter((s) => s.active);
  const inactive = services.filter((s) => !s.active);

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-dark-900 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link
              href={backHref}
              className="text-cyan-400 hover:text-cyan-300 text-sm mb-2 inline-flex items-center gap-1 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Админ-панель
            </Link>
            <h1 className="text-2xl font-bold text-white">Управление услугами</h1>
            <p className="text-gray-500 text-sm mt-1">
              {active.length} активных · {inactive.length} отключённых
            </p>
          </div>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary text-sm">
            {showForm ? "Отмена" : "+ Добавить услугу"}
          </button>
        </div>

        {/* Create form */}
        <AnimatePresence>
          {showForm && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="glass-card p-6 mb-8"
            >
              <h3 className="text-lg font-bold text-white mb-4">Новая услуга</h3>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Название</label>
                    <Input
                      type="text"
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Иконка (emoji)</label>
                    <Input
                      type="text"
                      value={form.icon}
                      onChange={(e) => setForm({ ...form, icon: e.target.value })}
                      placeholder="🔧"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Порядок</label>
                    <Input
                      type="number"
                      value={form.order}
                      onChange={(e) => setForm({ ...form, order: parseInt(e.target.value) })}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Описание</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="input-field min-h-[80px]"
                    required
                  />
                </div>
                <button type="submit" className="btn-primary">Создать</button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Services list */}
        <div className="space-y-3">
          {services.length === 0 && (
            <div className="text-center py-16 text-gray-500">Услуг пока нет. Создайте первую!</div>
          )}

          {services.map((service, i) => (
            <motion.div
              key={service.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className={`glass-card p-4 flex items-center gap-4 transition-opacity ${
                !service.active ? "opacity-50" : ""
              }`}
            >
              {/* Icon */}
              <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center">
                <ServiceIcon icon={service.icon} size={40} />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white">{service.title}</span>
                  <span className="text-xs text-gray-600">#{service.order}</span>
                  {!service.active && (
                    <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
                      Отключена
                    </span>
                  )}
                </div>
                <p className="text-gray-400 text-sm mt-0.5 truncate">{service.description}</p>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-3 flex-shrink-0">
                {/* Edit button */}
                <button
                  onClick={() => setEditingService(service)}
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                  title="Редактировать"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>

                {/* BUSINESS-PAY: документы услуги */}
                <button
                  onClick={() => setDocsService(service)}
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                  title="Документы услуги"
                  aria-label={`Документы услуги: ${service.title}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
                    <path strokeLinecap="round" strokeWidth={2} d="M14 3v5h5" />
                  </svg>
                </button>

                {/* Stages editor */}
                <button
                  onClick={() => setStagesService(service)}
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                  title="Этапы работы"
                  aria-label={`Этапы работы: ${service.title}`}
                >
                  <GearIcon size={16} />
                </button>

                {/* Toggle switch */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 hidden sm:block">
                    {service.active ? "Вкл" : "Выкл"}
                  </span>
                  {togglingId === service.id ? (
                    <div className="w-11 h-6 flex items-center justify-center">
                      <Spinner size="sm" />
                    </div>
                  ) : (
                    <Toggle
                      checked={service.active}
                      onChange={() => toggleActive(service)}
                    />
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Edit modal */}
      <AnimatePresence>
        {editingService && (
          <EditModal
            service={editingService}
            onClose={() => setEditingService(null)}
            onSaved={fetchServices}
          />
        )}
      </AnimatePresence>

      {/* Stages modal */}
      <AnimatePresence>
        {stagesService && (
          <ServiceStagesModal
            serviceId={stagesService.id}
            serviceTitle={stagesService.title}
            onClose={() => setStagesService(null)}
          />
        )}
      </AnimatePresence>

      {/* BUSINESS-PAY: documents modal */}
      <AnimatePresence>
        {docsService && (
          <ServiceDocumentsModal
            serviceId={docsService.id}
            serviceTitle={docsService.title}
            onClose={() => setDocsService(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
