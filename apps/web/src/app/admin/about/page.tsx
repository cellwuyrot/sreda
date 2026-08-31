"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import Spinner from "@/components/ui/Spinner";

// ─── Types ───────────────────────────────────────────────────────────────────
interface AboutBlock {
  id: string;
  order: number;
  title: string;
  description: string;
  mediaUrl: string | null;
  mediaType: string;
  layout: string;
  textAlign: string;
  glowColor: string;
  shape: string;
  spacingTop: number;
  enabled: boolean;
}

type BlockDraft = Omit<AboutBlock, "id" | "order">;

const BLANK_DRAFT: BlockDraft = {
  title: "",
  description: "",
  mediaUrl: null,
  mediaType: "image",
  layout: "text-left",
  textAlign: "left",
  glowColor: "#8b5cf6",
  shape: "rectangle",
  spacingTop: 60,
  enabled: true,
};

const LAYOUTS = [
  { value: "text-left",  label: "Текст слева",  icon: "◧" },
  { value: "text-right", label: "Текст справа", icon: "◨" },
  { value: "centered",   label: "По центру",    icon: "▣" },
];

const TEXT_ALIGNS = [
  { value: "left",   label: "По левому краю", icon: "≡◁" },
  { value: "center", label: "По центру",       icon: "≡" },
  { value: "right",  label: "По правому краю", icon: "▷≡" },
];

const SHAPES = [
  { value: "rectangle",    label: "Прямоугольник" },
  { value: "rounded",      label: "Закруглённый" },
  { value: "skewed-left",  label: "Наклон влево" },
  { value: "skewed-right", label: "Наклон вправо" },
  { value: "hexagon",      label: "Шестиугольник" },
  { value: "diamond",      label: "Ромб" },
];

// ─── Toast ───────────────────────────────────────────────────────────────────
function Toast({ message, type }: { message: string; type: "success" | "error" }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className={`fixed bottom-6 right-6 z-[100] rounded-xl px-5 py-3 text-sm font-medium text-white shadow-xl ${
        type === "success" ? "bg-green-600" : "bg-red-600"
      }`}
    >
      {message}
    </motion.div>
  );
}

// ─── BlockRow ─────────────────────────────────────────────────────────────────
function BlockRow({
  block, index, total,
  onEdit, onDelete, onMoveUp, onMoveDown, onToggle,
}: {
  block: AboutBlock; index: number; total: number;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggle: () => void;
}) {
  return (
    <div
      className={`rounded-2xl border transition-all ${
        block.enabled
          ? "border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900"
          : "border-dashed border-neutral-300 dark:border-white/5 bg-neutral-50/50 dark:bg-neutral-900/40 opacity-60"
      }`}
    >
      <div className="flex items-center gap-4 p-4">
        {/* Accent stripe */}
        <div className="w-1 h-12 rounded-full flex-shrink-0" style={{ background: block.glowColor }} />

        {/* Thumb */}
        <div
          className="w-14 h-14 rounded-xl flex-shrink-0 overflow-hidden flex items-center justify-center"
          style={{ background: `${block.glowColor}22`, border: `1px solid ${block.glowColor}44` }}
        >
          {block.mediaUrl ? (
            block.mediaType === "video" ? (
              <svg className="h-6 w-6" style={{ color: block.glowColor }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={block.mediaUrl} alt="" className="w-full h-full object-cover" />
            )
          ) : (
            <svg className="h-6 w-6 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-neutral-900 dark:text-white truncate">{block.title || "(без заголовка)"}</p>
          <p className="text-xs text-neutral-500 dark:text-gray-400 truncate mt-0.5">{block.description}</p>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
              {LAYOUTS.find(l => l.value === block.layout)?.label} · {SHAPES.find(s => s.value === block.shape)?.label} · отступ {block.spacingTop}px
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Up/Down */}
          <button onClick={onMoveUp} disabled={index === 0}
            className="p-2 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-white disabled:opacity-20 transition-colors"
            title="Вверх">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <button onClick={onMoveDown} disabled={index === total - 1}
            className="p-2 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-white disabled:opacity-20 transition-colors"
            title="Вниз">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {/* Toggle */}
          <button onClick={onToggle}
            className={`p-2 rounded-lg transition-colors ${
              block.enabled
                ? "text-green-500 hover:text-green-600"
                : "text-neutral-400 hover:text-neutral-600 dark:hover:text-white"
            }`}
            title={block.enabled ? "Скрыть" : "Показать"}>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {block.enabled
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              }
            </svg>
          </button>
          {/* Edit */}
          <button onClick={onEdit}
            className="p-2 rounded-lg text-neutral-400 hover:text-violet-600 dark:hover:text-cyan-400 transition-colors"
            title="Редактировать">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          {/* Delete */}
          <button onClick={onDelete}
            className="p-2 rounded-lg text-neutral-400 hover:text-red-500 transition-colors"
            title="Удалить">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── BlockEditor (modal) ──────────────────────────────────────────────────────
function BlockEditor({
  draft, onChange, onSave, onClose, saving, uploadMedia, uploading, uploadError,
}: {
  draft: BlockDraft;
  onChange: (d: Partial<BlockDraft>) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
  uploadMedia: (file: File) => Promise<void>;
  uploading: boolean;
  uploadError: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const inputCls = "w-full rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-4 py-2.5 text-sm text-neutral-900 dark:text-white placeholder-neutral-400 focus:border-violet-500 dark:focus:border-cyan-500 focus:outline-none transition-colors";
  const labelCls = "block text-xs font-medium text-neutral-500 dark:text-gray-400 mb-1.5";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-2xl p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-neutral-900 dark:text-white">Редактор блока</h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors">
            <svg className="h-5 w-5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Title */}
        <div>
          <label className={labelCls}>Заголовок</label>
          <input className={inputCls} value={draft.title} onChange={e => onChange({ title: e.target.value })} placeholder="Заголовок блока" />
        </div>

        {/* Description */}
        <div>
          <label className={labelCls}>Описание</label>
          <textarea className={`${inputCls} resize-y`} rows={4} value={draft.description} onChange={e => onChange({ description: e.target.value })} placeholder="Текст описания..." />
        </div>

        {/* Media upload */}
        <div>
          <label className={labelCls}>Медиафайл (картинка или видео)</label>
          <div
            className="relative rounded-2xl border-2 border-dashed border-neutral-200 dark:border-white/10 p-4 text-center cursor-pointer hover:border-violet-400 dark:hover:border-cyan-500 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMedia(f); }}
            />
            {uploading ? (
              <p className="text-sm text-neutral-500">Загрузка…</p>
            ) : draft.mediaUrl ? (
              <div className="space-y-2">
                {draft.mediaType === "video" ? (
                  <video src={draft.mediaUrl} className="mx-auto max-h-32 rounded-xl object-cover" />
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={draft.mediaUrl} alt="" className="mx-auto max-h-32 rounded-xl object-cover" />
                )}
                <p className="text-xs text-neutral-400">Нажмите, чтобы заменить</p>
              </div>
            ) : (
              <div className="py-4">
                <svg className="mx-auto h-10 w-10 text-neutral-300 dark:text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="mt-2 text-sm text-neutral-500">PNG, JPG, WebP, GIF, MP4, WebM · до 200 МБ</p>
              </div>
            )}
          </div>
          {uploadError && <p className="mt-1 text-xs text-red-500">{uploadError}</p>}
          {draft.mediaUrl && (
            <button onClick={() => onChange({ mediaUrl: null })} className="mt-1.5 text-xs text-red-500 hover:text-red-400">Убрать медиафайл</button>
          )}
        </div>

        {/* Layout */}
        <div>
          <label className={labelCls}>Расположение блока</label>
          <div className="grid grid-cols-3 gap-2">
            {LAYOUTS.map(l => (
              <button key={l.value} type="button"
                onClick={() => onChange({ layout: l.value })}
                className={`py-2 px-3 rounded-xl border text-sm font-medium transition-all ${
                  draft.layout === l.value
                    ? "border-violet-500 dark:border-cyan-500 bg-violet-500/10 dark:bg-cyan-500/10 text-violet-600 dark:text-cyan-400"
                    : "border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 text-neutral-600 dark:text-gray-300 hover:border-neutral-300 dark:hover:border-white/20"
                }`}
              >{l.icon} {l.label}</button>
            ))}
          </div>
        </div>

        {/* Text align */}
        <div>
          <label className={labelCls}>Выравнивание текста</label>
          <div className="grid grid-cols-3 gap-2">
            {TEXT_ALIGNS.map(a => (
              <button key={a.value} type="button"
                onClick={() => onChange({ textAlign: a.value })}
                className={`py-2 px-3 rounded-xl border text-sm font-medium transition-all ${
                  draft.textAlign === a.value
                    ? "border-violet-500 dark:border-cyan-500 bg-violet-500/10 dark:bg-cyan-500/10 text-violet-600 dark:text-cyan-400"
                    : "border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 text-neutral-600 dark:text-gray-300 hover:border-neutral-300 dark:hover:border-white/20"
                }`}
              >{a.icon} {a.label}</button>
            ))}
          </div>
        </div>

        {/* Shape */}
        <div>
          <label className={labelCls}>Форма блока</label>
          <div className="grid grid-cols-3 gap-2">
            {SHAPES.map(s => (
              <button key={s.value} type="button"
                onClick={() => onChange({ shape: s.value })}
                className={`py-2 px-3 rounded-xl border text-sm font-medium transition-all ${
                  draft.shape === s.value
                    ? "border-violet-500 dark:border-cyan-500 bg-violet-500/10 dark:bg-cyan-500/10 text-violet-600 dark:text-cyan-400"
                    : "border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 text-neutral-600 dark:text-gray-300 hover:border-neutral-300 dark:hover:border-white/20"
                }`}
              >{s.label}</button>
            ))}
          </div>
        </div>

        {/* Glow color */}
        <div>
          <label className={labelCls}>Цвет свечения / градиента</label>
          <div className="flex items-center gap-3">
            <input type="color" value={draft.glowColor} onChange={e => onChange({ glowColor: e.target.value })}
              className="h-10 w-14 cursor-pointer rounded-xl border border-neutral-200 dark:border-white/10 bg-transparent p-1" />
            <input className={`${inputCls} flex-1`} value={draft.glowColor} onChange={e => onChange({ glowColor: e.target.value })} placeholder="#8b5cf6" />
            <div className="h-10 w-10 rounded-xl flex-shrink-0 border border-neutral-200 dark:border-white/10" style={{ background: `radial-gradient(circle, ${draft.glowColor}88, transparent 70%)` }} />
          </div>
          {/* Presets */}
          <div className="flex gap-2 mt-2 flex-wrap">
            {["#8b5cf6","#06b6d4","#ec4899","#f97316","#10b981","#ef4444","#3b82f6","#eab308","#ffffff"].map(c => (
              <button key={c} onClick={() => onChange({ glowColor: c })}
                className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
                style={{ backgroundColor: c, borderColor: draft.glowColor === c ? "#fff" : "transparent" }}
              />
            ))}
          </div>
        </div>

        {/* Spacing top */}
        <div>
          <label className={labelCls}>Отступ сверху: <strong>{draft.spacingTop}px</strong></label>
          <input type="range" min={0} max={400} step={4}
            value={draft.spacingTop}
            onChange={e => onChange({ spacingTop: Number(e.target.value) })}
            className="w-full accent-violet-600 dark:accent-cyan-500"
          />
          <div className="flex justify-between text-[11px] text-neutral-400 mt-0.5">
            <span>0px</span><span>200px</span><span>400px</span>
          </div>
        </div>

        {/* Enabled */}
        <div className="flex items-center justify-between rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-4 py-3">
          <span className="text-sm font-medium text-neutral-900 dark:text-white">Показывать блок</span>
          <button type="button" role="switch" aria-checked={draft.enabled}
            onClick={() => onChange({ enabled: !draft.enabled })}
            className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
              draft.enabled ? "bg-violet-600 dark:bg-cyan-500" : "bg-neutral-300 dark:bg-white/15"
            }`}>
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${draft.enabled ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </div>

        {/* Buttons */}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-5 py-2 rounded-xl text-sm text-neutral-600 dark:text-gray-300 border border-neutral-200 dark:border-white/10 hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors">Отмена</button>
          <button onClick={onSave} disabled={saving}
            className="px-5 py-2 rounded-xl text-sm font-medium text-white bg-violet-600 dark:bg-cyan-600 hover:bg-violet-500 dark:hover:bg-cyan-500 disabled:opacity-50 transition-colors">
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AdminAboutPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [blocks, setBlocks] = useState<AboutBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Background settings
  const [bgUrl, setBgUrl]   = useState("");
  const [bgColor, setBgColor] = useState("#000000");
  const [bgUploading, setBgUploading] = useState(false);
  const bgFileRef = useRef<HTMLInputElement>(null);

  // Block editor
  const [editingId, setEditingId] = useState<string | null>(null); // null = new
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<BlockDraft>({ ...BLANK_DRAFT });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ── auth guard
  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") router.push("/");
  }, [session, status, router]);

  // ── load data
  useEffect(() => {
    if (status !== "authenticated") return;
    Promise.all([
      fetch("/api/admin/about-blocks").then(r => r.ok ? r.json() : []),
      fetch("/api/site-content").then(r => r.ok ? r.json() : {}),
    ]).then(([blockData, siteData]: [AboutBlock[], Record<string, string>]) => {
      setBlocks(blockData);
      if (siteData["about.bg.url"]) setBgUrl(siteData["about.bg.url"]);
      if (siteData["about.bg.color"]) setBgColor(siteData["about.bg.color"]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [status]);

  // ── move up/down
  const move = async (index: number, dir: -1 | 1) => {
    const next = [...blocks];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    const reordered = next.map((b, i) => ({ ...b, order: i }));
    setBlocks(reordered);
    await fetch("/api/admin/about-blocks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reordered.map(b => ({ id: b.id, order: b.order }))),
    }).catch(() => showToast("Ошибка при сохранении порядка", "error"));
  };

  // ── toggle visibility
  const toggleBlock = async (block: AboutBlock) => {
    const updated = { ...block, enabled: !block.enabled };
    setBlocks(prev => prev.map(b => b.id === block.id ? updated : b));
    await fetch(`/api/admin/about-blocks/${block.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    }).catch(() => showToast("Ошибка", "error"));
  };

  // ── delete
  const deleteBlock = async (id: string) => {
    if (!confirm("Удалить блок?")) return;
    await fetch(`/api/admin/about-blocks/${id}`, { method: "DELETE" });
    setBlocks(prev => prev.filter(b => b.id !== id));
    showToast("Блок удалён", "success");
  };

  // ── open editor
  const openNew = () => {
    setEditingId(null);
    setDraft({ ...BLANK_DRAFT });
    setUploadError("");
    setEditorOpen(true);
  };
  const openEdit = (block: AboutBlock) => {
    setEditingId(block.id);
    setDraft({
      title: block.title, description: block.description,
      mediaUrl: block.mediaUrl, mediaType: block.mediaType,
      layout: block.layout, textAlign: block.textAlign,
      glowColor: block.glowColor, shape: block.shape,
      spacingTop: block.spacingTop, enabled: block.enabled,
    });
    setUploadError("");
    setEditorOpen(true);
  };

  // ── save block
  const saveBlock = async () => {
    setSaving(true);
    try {
      if (editingId) {
        const res = await fetch(`/api/admin/about-blocks/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
        const updated: AboutBlock = await res.json();
        setBlocks(prev => prev.map(b => b.id === editingId ? updated : b));
      } else {
        const res = await fetch("/api/admin/about-blocks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
        const created: AboutBlock = await res.json();
        setBlocks(prev => [...prev, created]);
      }
      setEditorOpen(false);
      showToast("Сохранено", "success");
    } catch {
      showToast("Ошибка при сохранении", "error");
    } finally {
      setSaving(false);
    }
  };

  // ── upload media
  const uploadMedia = async (file: File) => {
    setUploading(true);
    setUploadError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "media");
      const res = await fetch("/api/admin/about-upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      setDraft(prev => ({ ...prev, mediaUrl: data.url, mediaType: data.type }));
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setUploading(false);
    }
  };

  // ── background upload
  const uploadBg = async (file: File) => {
    setBgUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "bg");
      const res = await fetch("/api/admin/about-upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      setBgUrl(data.url);
      await saveSiteKey("about.bg.url", data.url);
      showToast("Фон загружен", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Ошибка загрузки", "error");
    } finally {
      setBgUploading(false);
    }
  };

  const saveSiteKey = async (key: string, value: string) => {
    await fetch("/api/site-content", {
      method: value ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
  };

  const saveBgColor = async (color: string) => {
    setBgColor(color);
    await saveSiteKey("about.bg.color", color);
  };

  const removeBg = async () => {
    setBgUrl("");
    await saveSiteKey("about.bg.url", "");
    showToast("Фон удалён", "success");
  };

  if (status === "loading" || loading) {
    return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
  }
  if (session?.user?.role !== "ADMIN") return null;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 px-4 pb-28 pt-8">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-8">
          <Link href="/admin" className="mb-2 inline-flex items-center gap-1 text-sm text-violet-600 dark:text-cyan-400 hover:opacity-80">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Админ-панель
          </Link>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">О проекте — лендинг</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-gray-400">
            Блоки и фон страницы{" "}
            <Link href="/about" target="_blank" className="text-violet-600 dark:text-cyan-400 hover:underline">/about ↗</Link>
          </p>
        </div>

        {/* ── Background section ── */}
        <section className="mb-8 rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 p-6 space-y-4">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-white">Фон страницы</h2>

          {/* Color */}
          <div className="flex items-center gap-4">
            <div>
              <p className="text-xs text-neutral-500 dark:text-gray-400 mb-1">Цвет фона (по умолчанию чёрный)</p>
              <div className="flex items-center gap-2">
                <input type="color" value={bgColor}
                  onChange={e => saveBgColor(e.target.value)}
                  className="h-10 w-14 cursor-pointer rounded-xl border border-neutral-200 dark:border-white/10 bg-transparent p-1" />
                <span className="text-sm font-mono text-neutral-600 dark:text-gray-300">{bgColor}</span>
              </div>
            </div>
            <div
              className="h-16 w-24 rounded-xl border border-neutral-200 dark:border-white/10 flex-shrink-0"
              style={{ backgroundColor: bgColor, backgroundImage: bgUrl ? `url(${bgUrl})` : undefined, backgroundRepeat: "repeat", backgroundSize: "auto" }}
            />
          </div>

          {/* Texture upload */}
          <div>
            <p className="text-xs text-neutral-500 dark:text-gray-400 mb-2">Текстура / изображение фона (бесшовная, PNG/JPG)</p>
            <div
              className="relative rounded-2xl border-2 border-dashed border-neutral-200 dark:border-white/10 p-4 cursor-pointer hover:border-violet-400 dark:hover:border-cyan-500 transition-colors text-center"
              onClick={() => bgFileRef.current?.click()}
            >
              <input ref={bgFileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadBg(f); }} />
              {bgUploading ? (
                <p className="text-sm text-neutral-500">Загрузка…</p>
              ) : bgUrl ? (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-neutral-500 dark:text-gray-400 truncate max-w-xs">{bgUrl}</span>
                  <button onClick={(e) => { e.stopPropagation(); removeBg(); }}
                    className="text-xs text-red-500 hover:text-red-400 ml-3 flex-shrink-0">Удалить</button>
                </div>
              ) : (
                <p className="text-sm text-neutral-400 py-2">Загрузить текстуру фона (PNG, JPG, WebP · до 10 МБ)</p>
              )}
            </div>
          </div>
        </section>

        {/* ── Blocks section ── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-white">Блоки страницы ({blocks.length})</h2>
            <button onClick={openNew}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 dark:bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 dark:hover:bg-cyan-500 transition-colors">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Добавить блок
            </button>
          </div>

          {blocks.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-neutral-200 dark:border-white/10 p-12 text-center">
              <p className="text-neutral-400 dark:text-neutral-600">Блоков пока нет</p>
              <button onClick={openNew} className="mt-3 text-sm text-violet-600 dark:text-cyan-400 hover:underline">Создать первый блок</button>
            </div>
          ) : (
            <div className="space-y-3">
              {blocks.map((block, i) => (
                <BlockRow key={block.id} block={block} index={i} total={blocks.length}
                  onEdit={() => openEdit(block)}
                  onDelete={() => deleteBlock(block.id)}
                  onMoveUp={() => move(i, -1)}
                  onMoveDown={() => move(i, 1)}
                  onToggle={() => toggleBlock(block)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Editor modal */}
      <AnimatePresence>
        {editorOpen && (
          <BlockEditor
            draft={draft}
            onChange={patch => setDraft(prev => ({ ...prev, ...patch }))}
            onSave={saveBlock}
            onClose={() => setEditorOpen(false)}
            saving={saving}
            uploadMedia={uploadMedia}
            uploading={uploading}
            uploadError={uploadError}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>{toast && <Toast message={toast.message} type={toast.type} />}</AnimatePresence>
    </div>
  );
}
