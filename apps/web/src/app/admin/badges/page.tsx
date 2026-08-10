"use client";

import { useState, useEffect, useRef } from "react";
import { confirmDialog, alertDialog } from "@/components/ui/ConfirmDialog";
import Spinner from "@/components/ui/Spinner";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import Link from "next/link";

import { useAdminBackHref } from "@/components/admin/useAdminBackHref"; // FIX-EDR2
interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  imageUrl: string | null;
  rarity: string;
  active: boolean;
  _count: { users: number };
  createdAt: string;
}

interface UserOption {
  id: string;
  name: string;
  username: string;
}

const RARITIES = [
  { value: "common", label: "Обычное", color: "text-gray-400" },
  { value: "uncommon", label: "Необычное", color: "text-green-400" },
  { value: "rare", label: "Редкое", color: "text-blue-400" },
  { value: "epic", label: "Эпическое", color: "text-purple-400" },
  { value: "legendary", label: "Легендарное", color: "text-amber-400" },
];

export default function AdminBadgesPage() {
  // FIX-EDR2: редактору «Назад» ведёт в «Редакторскую», админу — в админку
  const backHref = useAdminBackHref();
  const { data: session, status } = useSession();
  const router = useRouter();
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editBadge, setEditBadge] = useState<Badge | null>(null);
  const [showAward, setShowAward] = useState<Badge | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [awardUserId, setAwardUserId] = useState("");

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN" && session?.user?.role !== "EDITOR") router.push("/");
  }, [session, status, router]);

  const fetchBadges = () => {
    fetch("/api/admin/badges").then((r) => r.json()).then(setBadges).finally(() => setLoading(false));
  };

  useEffect(() => { fetchBadges(); }, []);

  useEffect(() => {
    if (showAward) {
      fetch("/api/users").then((r) => r.json()).then(setUsers);
    }
  }, [showAward]);

  const deleteBadge = async (id: string) => {
    if (!(await confirmDialog({ message: "Удалить достижение?", confirmText: "Удалить", danger: true }))) return;
    await fetch(`/api/admin/badges/${id}`, { method: "DELETE" });
    fetchBadges();
  };

  const awardBadge = async () => {
    if (!showAward || !awardUserId) return;
    const res = await fetch("/api/admin/badges/award", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ badgeId: showAward.id, userId: awardUserId }),
    });
    if (res.ok) {
      setShowAward(null);
      setAwardUserId("");
      fetchBadges();
    } else {
      const data = await res.json();
      await alertDialog(data.error || "Ошибка");
    }
  };

  if (status === "loading" || loading) {
    return <div className="min-h-screen flex items-center justify-center"><Spinner /></div>;
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 pt-20 pb-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href={backHref} className="text-accent hover:opacity-70">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </Link>
            <h1 className="text-xl font-bold text-neutral-900 dark:text-white">Управление достижениями</h1>
          </div>
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-violet-600 dark:bg-cyan-600 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity">
            + Создать
          </button>
        </div>

        <div className="grid gap-4">
          {badges.map((badge) => (
            <motion.div key={badge.id} layout className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl p-4 flex items-center gap-4">
              <div className="w-16 h-16 flex-shrink-0 flex items-center justify-center bg-neutral-100 dark:bg-white/5 rounded-xl">
                {badge.imageUrl ? (
                  <Image src={badge.imageUrl} alt={badge.name} width={48} height={48} className="object-contain" />
                ) : (
                  <span className="text-3xl">{badge.icon || "🏅"}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">{badge.name}</h3>
                  <span className={`text-xs ${RARITIES.find((r) => r.value === badge.rarity)?.color || "text-gray-400"}`}>
                    {RARITIES.find((r) => r.value === badge.rarity)?.label}
                  </span>
                  {!badge.active && <span className="text-xs text-red-400">(неактивно)</span>}
                </div>
                <p className="text-xs text-neutral-500 dark:text-gray-400 truncate">{badge.description}</p>
                <p className="text-[10px] text-neutral-400 mt-1">Выдано: {badge._count.users} пользователям</p>
              </div>
              <div className="flex gap-1">
                <button onClick={() => setShowAward(badge)} className="p-2 rounded-lg hover:bg-green-50 dark:hover:bg-green-400/10 text-green-600 dark:text-green-400 transition-colors" title="Выдать">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                </button>
                <button onClick={() => setEditBadge(badge)} className="p-2 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-400/10 text-violet-600 dark:text-violet-400 transition-colors" title="Редактировать">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                </button>
                <button onClick={() => deleteBadge(badge.id)} className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-400/10 text-red-600 dark:text-red-400 transition-colors" title="Удалить">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>
            </motion.div>
          ))}
          {badges.length === 0 && (
            <p className="text-center text-neutral-400 py-12">Нет достижений. Создайте первое!</p>
          )}
        </div>
      </div>

      {/* Create/Edit Modal */}
      <AnimatePresence>
        {(showCreate || editBadge) && (
          <BadgeFormModal
            badge={editBadge}
            onClose={() => { setShowCreate(false); setEditBadge(null); }}
            onSaved={fetchBadges}
          />
        )}
      </AnimatePresence>

      {/* Award Modal */}
      <AnimatePresence>
        {showAward && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowAward(null)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-neutral-900 dark:text-white mb-4">Выдать: {showAward.name}</h3>
              <select value={awardUserId} onChange={(e) => setAwardUserId(e.target.value)} className="w-full bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-neutral-900 dark:text-white text-sm mb-4">
                <option value="">Выберите пользователя...</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name} (@{u.username})</option>)}
              </select>
              <div className="flex gap-2">
                <button onClick={awardBadge} disabled={!awardUserId} className="flex-1 px-4 py-2 bg-green-500 text-white rounded-xl text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity">Выдать</button>
                <button onClick={() => setShowAward(null)} className="flex-1 px-4 py-2 bg-neutral-100 dark:bg-white/5 text-neutral-600 dark:text-gray-400 rounded-xl text-sm">Отмена</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BadgeFormModal({ badge, onClose, onSaved }: { badge: Badge | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(badge?.name || "");
  const [description, setDescription] = useState(badge?.description || "");
  const [icon, setIcon] = useState(badge?.icon || "");
  const [rarity, setRarity] = useState(badge?.rarity || "common");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(badge?.imageUrl || null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !description.trim()) return;
    setSaving(true);

    const fd = new FormData();
    fd.append("name", name);
    fd.append("description", description);
    fd.append("icon", icon);
    fd.append("rarity", rarity);
    if (fileRef.current?.files?.[0]) fd.append("image", fileRef.current.files[0]);

    const url = badge ? `/api/admin/badges/${badge.id}` : "/api/admin/badges";
    const method = badge ? "PATCH" : "POST";
    await fetch(url, { method, body: fd });

    setSaving(false);
    onSaved();
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setPreviewUrl(URL.createObjectURL(file));
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl p-6 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-neutral-900 dark:text-white mb-4">{badge ? "Редактировать" : "Создать"} достижение</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-neutral-500 dark:text-gray-400 block mb-1">Название</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required className="w-full bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-neutral-900 dark:text-white text-sm" placeholder="Название достижения" />
          </div>
          <div>
            <label className="text-sm text-neutral-500 dark:text-gray-400 block mb-1">Описание</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} required rows={3} className="w-full bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-neutral-900 dark:text-white text-sm resize-none" placeholder="Как получить это достижение..." />
          </div>
          <div className="flex gap-3">
            <div className="w-20">
              <label className="text-sm text-neutral-500 dark:text-gray-400 block mb-1">Emoji</label>
              <input value={icon} onChange={(e) => setIcon(e.target.value)} className="w-full bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-neutral-900 dark:text-white text-sm text-center" placeholder="🏅" />
            </div>
            <div className="flex-1">
              <label className="text-sm text-neutral-500 dark:text-gray-400 block mb-1">Редкость</label>
              <select value={rarity} onChange={(e) => setRarity(e.target.value)} className="w-full bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-neutral-900 dark:text-white text-sm">
                {RARITIES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-sm text-neutral-500 dark:text-gray-400 block mb-1">Изображение (128x128px, до 512KB)</label>
            <div className="flex items-center gap-3">
              {previewUrl && <Image src={previewUrl} alt="preview" width={48} height={48} className="w-12 h-12 rounded-lg object-contain bg-neutral-100 dark:bg-white/5" />}
              <button type="button" onClick={() => fileRef.current?.click()} className="px-3 py-2 bg-neutral-100 dark:bg-white/5 rounded-xl text-sm text-neutral-600 dark:text-gray-400 hover:bg-neutral-200 dark:hover:bg-white/10 transition-colors">
                Выбрать файл
              </button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleFileChange} className="hidden" />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2.5 bg-violet-600 dark:bg-cyan-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity">
              {saving ? "..." : badge ? "Сохранить" : "Создать"}
            </button>
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 bg-neutral-100 dark:bg-white/5 text-neutral-600 dark:text-gray-400 rounded-xl text-sm">Отмена</button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
