"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import type {
  AboutBlockRow,
  BlockType,
  HeroData,
  VideoData,
  StatsData,
  StatsItem,
  GalleryData,
  GalleryItem,
  BentoData,
  BentoItem,
  TimelineData,
  TimelineItem,
  TeamData,
  TeamMember,
  CtaData,
} from "@/lib/aboutBlocks";
import { BLOCK_DEFAULTS, BLOCK_LABELS, BLOCK_TYPES } from "@/lib/aboutBlocks";

// ─── tiny UI helpers ────────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder-neutral-600 focus:border-indigo-500/60 focus:outline-none focus:ring-0 transition-colors";
const labelCls = "block mb-1 text-[11px] font-semibold uppercase tracking-widest text-neutral-500";
const btnPri =
  "flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

function Inp({ value, onChange, placeholder, type = "text" }: {
  value?: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      className={inputCls}
      type={type}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function TextArea({ value, onChange, rows = 3, placeholder }: {
  value?: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <textarea
      className={inputCls + " resize-y"}
      rows={rows}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// ─── Block editor forms ──────────────────────────────────────────────────────

function HeroEditor({ data, onChange }: { data: HeroData; onChange: (d: HeroData) => void }) {
  const upd = (patch: Partial<HeroData>) => onChange({ ...data, ...patch });
  return (
    <>
      <Field label="Badge (верхняя строка)">
        <Inp value={data.badge} onChange={(v) => upd({ badge: v })} placeholder="Платформа открыта" />
      </Field>
      <Field label="Заголовок">
        <Inp value={data.title} onChange={(v) => upd({ title: v })} placeholder="TRIOZ" />
      </Field>
      <Field label="Подзаголовок">
        <Inp value={data.subtitle} onChange={(v) => upd({ subtitle: v })} placeholder="Экосистема проектов" />
      </Field>
      <Field label="Описание">
        <TextArea value={data.description} onChange={(v) => upd({ description: v })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Кнопка 1 — текст">
          <Inp value={data.primaryCta?.label} onChange={(v) => upd({ primaryCta: { ...data.primaryCta!, label: v } })} />
        </Field>
        <Field label="Кнопка 1 — href">
          <Inp value={data.primaryCta?.href} onChange={(v) => upd({ primaryCta: { ...data.primaryCta!, href: v } })} placeholder="/connect" />
        </Field>
        <Field label="Кнопка 2 — текст">
          <Inp value={data.secondaryCta?.label} onChange={(v) => upd({ secondaryCta: { ...data.secondaryCta, label: v } })} />
        </Field>
        <Field label="Кнопка 2 — href (или action=video)">
          <Inp value={data.secondaryCta?.href ?? data.secondaryCta?.action} onChange={(v) => upd({ secondaryCta: { ...data.secondaryCta, href: v === 'video' ? undefined : v, action: v === 'video' ? 'video' : undefined, label: data.secondaryCta?.label ?? '' } })} placeholder="/projects или video" />
        </Field>
      </div>
    </>
  );
}

function VideoEditor({ data, onChange }: { data: VideoData; onChange: (d: VideoData) => void }) {
  const upd = (patch: Partial<VideoData>) => onChange({ ...data, ...patch });
  return (
    <>
      <Field label="YouTube ID (или прямая ссылка на mp4)">
        <Inp value={data.youtubeId} onChange={(v) => upd({ youtubeId: v, url: '' })} placeholder="dQw4w9WgXcQ" />
        <p className="mt-1 text-[11px] text-neutral-600">Либо прямая ссылка на видеофайл:</p>
      </Field>
      <Field label="URL видео (.mp4 / .webm)">
        <Inp value={data.url} onChange={(v) => upd({ url: v, youtubeId: '' })} placeholder="/uploads/about/video.mp4" />
      </Field>
      <Field label="Заголовок под видео"><Inp value={data.title} onChange={(v) => upd({ title: v })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Длительность"><Inp value={data.duration} onChange={(v) => upd({ duration: v })} placeholder="3:47" /></Field>
        <Field label="Тег (emoji + текст)"><Inp value={data.tag} onChange={(v) => upd({ tag: v })} placeholder="🎬 Трейлер" /></Field>
      </div>
    </>
  );
}

function StatsEditor({ data, onChange }: { data: StatsData; onChange: (d: StatsData) => void }) {
  const items = data.items ?? [];
  const updItem = (i: number, patch: Partial<StatsItem>) => {
    const next = items.map((it, j) => (j === i ? { ...it, ...patch } : it));
    onChange({ ...data, items: next });
  };
  return (
    <>
      {items.map((it, i) => (
        <div key={i} className="flex gap-2 items-end mb-2">
          <div className="flex-1"><Field label={`Значение ${i + 1}`}><Inp value={it.value} onChange={(v) => updItem(i, { value: v })} /></Field></div>
          <div className="flex-[2]"><Field label="Подпись"><Inp value={it.label} onChange={(v) => updItem(i, { label: v })} /></Field></div>
          <button className="mb-4 text-red-500 text-xl" onClick={() => onChange({ ...data, items: items.filter((_, j) => j !== i) })}>×</button>
        </div>
      ))}
      <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={() => onChange({ ...data, items: [...items, { value: '', label: '' }] })}>+ Добавить статистику</button>
    </>
  );
}

function GalleryEditor({ data, onChange, blockId }: { data: GalleryData; onChange: (d: GalleryData) => void; blockId: string }) {
  const items = data.items ?? [];
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/about-media', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('upload failed');
      const json = await res.json() as { url: string; mediaType: string };
      const newItem: GalleryItem = {
        id: Date.now().toString(),
        mediaType: json.mediaType as GalleryItem['mediaType'],
        url: json.url,
        caption: file.name.replace(/\.[^.]+$/, ''),
      };
      onChange({ ...data, items: [...items, newItem] });
    } catch {
      alert('Ошибка загрузки файла');
    } finally {
      setUploading(false);
    }
  };

  const updItem = (id: string, patch: Partial<GalleryItem>) =>
    onChange({ ...data, items: items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });

  const removeItem = (id: string) => onChange({ ...data, items: items.filter((it) => it.id !== id) });

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Заголовок"><Inp value={data.title} onChange={(v) => onChange({ ...data, title: v })} /></Field>
        <Field label="Подзаголовок"><Inp value={data.subtitle} onChange={(v) => onChange({ ...data, subtitle: v })} /></Field>
      </div>

      {/* Upload zone */}
      <div
        className="mb-4 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/10 p-6 cursor-pointer hover:border-indigo-500/40 transition-colors"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) upload(f); }}
      >
        <input ref={fileRef} type="file" hidden accept="image/*,video/*,.gif" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
        {uploading ? (
          <div className="flex items-center gap-2 text-sm text-indigo-400">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
            Загрузка...
          </div>
        ) : (
          <>
            <div className="mb-2 text-2xl">📁</div>
            <p className="text-sm text-neutral-500">Перетащите файл или нажмите</p>
            <p className="text-xs text-neutral-700 mt-1">JPG, PNG, WebP, GIF, MP4, WebM · до 200 MB</p>
          </>
        )}
      </div>

      {/* Items */}
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex gap-2 rounded-lg border border-white/07 bg-white/[0.02] p-3">
            <div className="h-12 w-20 flex-shrink-0 overflow-hidden rounded-md bg-neutral-900">
              {item.mediaType === 'video' ? (
                <video src={item.url} className="h-full w-full object-cover" muted />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.url} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <input className={inputCls + ' mb-1.5 text-xs'} value={item.caption ?? ''} placeholder="Подпись" onChange={(e) => updItem(item.id, { caption: e.target.value })} />
              <input className={inputCls + ' text-xs'} value={item.tag ?? ''} placeholder="Тег" onChange={(e) => updItem(item.id, { tag: e.target.value })} />
            </div>
            <button className="text-red-500 text-xl self-start" onClick={() => removeItem(item.id)}>×</button>
          </div>
        ))}
      </div>
    </>
  );
}

function BentoEditor({ data, onChange }: { data: BentoData; onChange: (d: BentoData) => void }) {
  const items = data.items ?? [];
  const updItem = (i: number, patch: Partial<BentoItem>) =>
    onChange({ ...data, items: items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Заголовок"><Inp value={data.title} onChange={(v) => onChange({ ...data, title: v })} /></Field>
        <Field label="Подзаголовок"><Inp value={data.subtitle} onChange={(v) => onChange({ ...data, subtitle: v })} /></Field>
      </div>
      {items.map((it, i) => (
        <div key={it.key} className="mb-3 rounded-xl border border-white/07 bg-white/[0.025] p-3">
          <div className="grid grid-cols-3 gap-2 mb-2">
            <Field label="Иконка"><Inp value={it.icon} onChange={(v) => updItem(i, { icon: v })} /></Field>
            <Field label="Заголовок"><Inp value={it.title} onChange={(v) => updItem(i, { title: v })} /></Field>
            <Field label="Цвет (hex)"><Inp value={it.color} onChange={(v) => updItem(i, { color: v })} /></Field>
          </div>
          <Field label="Описание"><TextArea rows={2} value={it.description} onChange={(v) => updItem(i, { description: v })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Href"><Inp value={it.href} onChange={(v) => updItem(i, { href: v })} /></Field>
            <Field label="Широкая карточка (2 колонки)">
              <button
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold border transition-colors ${ it.wide ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300' : 'border-white/10 text-neutral-500' }`}
                onClick={() => updItem(i, { wide: !it.wide })}
              >
                {it.wide ? '✓ Широкая' : 'Обычная'}
              </button>
            </Field>
          </div>
        </div>
      ))}
      <button
        className="text-xs text-indigo-400 hover:text-indigo-300"
        onClick={() => onChange({ ...data, items: [...items, { key: Date.now().toString(), icon: '✨', title: 'Новый раздел', description: '', color: '#6366f1' }] })}
      >+ Добавить карточку</button>
    </>
  );
}

function TimelineEditor({ data, onChange }: { data: TimelineData; onChange: (d: TimelineData) => void }) {
  const items = data.items ?? [];
  const updItem = (i: number, patch: Partial<TimelineItem>) =>
    onChange({ ...data, items: items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  return (
    <>
      <Field label="Заголовок"><Inp value={data.title} onChange={(v) => onChange({ ...data, title: v })} /></Field>
      {items.map((it, i) => (
        <div key={i} className="mb-3 rounded-xl border border-white/07 bg-white/[0.025] p-3">
          <div className="grid grid-cols-4 gap-2 mb-2">
            <Field label="Год"><Inp value={it.year} onChange={(v) => updItem(i, { year: v })} /></Field>
            <div className="col-span-2"><Field label="Заголовок"><Inp value={it.title} onChange={(v) => updItem(i, { title: v })} /></Field></div>
            <Field label="Цвет">
              <div className="flex items-center gap-2">
                <Inp value={it.color} onChange={(v) => updItem(i, { color: v })} placeholder="#6366f1" />
                <div className="h-7 w-7 flex-shrink-0 rounded-lg border border-white/10" style={{ background: it.color ?? '#6366f1' }} />
              </div>
            </Field>
          </div>
          <Field label="Описание"><TextArea rows={2} value={it.description} onChange={(v) => updItem(i, { description: v })} /></Field>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-neutral-500 cursor-pointer">
              <input type="checkbox" checked={!!it.current} onChange={(e) => updItem(i, { current: e.target.checked })} className="accent-indigo-500" />
              Текущий этап
            </label>
            <button className="ml-auto text-red-500 text-xs" onClick={() => onChange({ ...data, items: items.filter((_, j) => j !== i) })}>Удалить</button>
          </div>
        </div>
      ))}
      <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={() => onChange({ ...data, items: [...items, { year: new Date().getFullYear().toString(), title: 'Новый этап', color: '#6366f1' }] })}>+ Добавить этап</button>
    </>
  );
}

function TeamEditor({ data, onChange }: { data: TeamData; onChange: (d: TeamData) => void }) {
  const members = data.members ?? [];
  const updMember = (i: number, patch: Partial<TeamMember>) =>
    onChange({ ...data, members: members.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  return (
    <>
      <Field label="Заголовок раздела"><Inp value={data.title} onChange={(v) => onChange({ ...data, title: v })} /></Field>
      {members.map((m, i) => (
        <div key={m.id} className="mb-3 rounded-xl border border-white/07 bg-white/[0.025] p-3">
          <div className="grid grid-cols-4 gap-2">
            <Field label="Emoji"><Inp value={m.emoji} onChange={(v) => updMember(i, { emoji: v })} placeholder="👤" /></Field>
            <div className="col-span-2"><Field label="Имя / роль"><Inp value={m.name} onChange={(v) => updMember(i, { name: v })} /></Field></div>
            <Field label="Роль"><Inp value={m.role} onChange={(v) => updMember(i, { role: v })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Аватар URL"><Inp value={m.avatarUrl} onChange={(v) => updMember(i, { avatarUrl: v })} placeholder="/uploads/about/..." /></Field>
            <Field label="Цвет">
              <div className="flex gap-2 items-center">
                <Inp value={m.color} onChange={(v) => updMember(i, { color: v })} placeholder="#6366f1" />
                <div className="h-7 w-7 flex-shrink-0 rounded-lg border border-white/10" style={{ background: m.color ?? '#6366f1' }} />
              </div>
            </Field>
          </div>
          <button className="text-red-500 text-xs" onClick={() => onChange({ ...data, members: members.filter((_, j) => j !== i) })}>Удалить участника</button>
        </div>
      ))}
      <button className="text-xs text-indigo-400 hover:text-indigo-300 mr-4" onClick={() => onChange({ ...data, members: [...members, { id: Date.now().toString(), name: 'Новый участник', role: '', emoji: '👤', color: '#6366f1' }] })}>+ Добавить</button>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Field label="Текст кнопки &quot;+&quot;"><Inp value={data.joinLabel} onChange={(v) => onChange({ ...data, joinLabel: v })} /></Field>
        <Field label="Href кнопки"><Inp value={data.joinHref} onChange={(v) => onChange({ ...data, joinHref: v })} /></Field>
      </div>
    </>
  );
}

function CtaEditor({ data, onChange }: { data: CtaData; onChange: (d: CtaData) => void }) {
  const upd = (patch: Partial<CtaData>) => onChange({ ...data, ...patch });
  return (
    <>
      <Field label="Заголовок"><Inp value={data.title} onChange={(v) => upd({ title: v })} /></Field>
      <Field label="Подзаголовок"><Inp value={data.subtitle} onChange={(v) => upd({ subtitle: v })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Кнопка 1 — текст"><Inp value={data.primaryCta?.label} onChange={(v) => upd({ primaryCta: { ...data.primaryCta!, label: v } })} /></Field>
        <Field label="Кнопка 1 — href"><Inp value={data.primaryCta?.href} onChange={(v) => upd({ primaryCta: { ...data.primaryCta!, href: v } })} /></Field>
        <Field label="Кнопка 2 — текст"><Inp value={data.secondaryCta?.label} onChange={(v) => upd({ secondaryCta: { ...data.secondaryCta!, label: v } })} /></Field>
        <Field label="Кнопка 2 — href"><Inp value={data.secondaryCta?.href} onChange={(v) => upd({ secondaryCta: { ...data.secondaryCta!, href: v } })} /></Field>
      </div>
    </>
  );
}

function BlockEditorForm({ block, onChange }: { block: AboutBlockRow; onChange: (d: unknown) => void }) {
  const d = block.data as unknown;
  switch (block.type) {
    case 'hero':     return <HeroEditor data={d as HeroData} onChange={onChange as unknown as (d: HeroData) => void} />;
    case 'video':    return <VideoEditor data={d as VideoData} onChange={onChange as unknown as (d: VideoData) => void} />;
    case 'stats':    return <StatsEditor data={d as StatsData} onChange={onChange as unknown as (d: StatsData) => void} />;
    case 'gallery':  return <GalleryEditor data={d as GalleryData} onChange={onChange as unknown as (d: GalleryData) => void} blockId={block.id} />;
    case 'bento':    return <BentoEditor data={d as BentoData} onChange={onChange as unknown as (d: BentoData) => void} />;
    case 'timeline': return <TimelineEditor data={d as TimelineData} onChange={onChange as unknown as (d: TimelineData) => void} />;
    case 'team':     return <TeamEditor data={d as TeamData} onChange={onChange as unknown as (d: TeamData) => void} />;
    case 'cta':      return <CtaEditor data={d as CtaData} onChange={onChange as unknown as (d: CtaData) => void} />;
    default:         return null;
  }
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function AdminContentPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [blocks, setBlocks] = useState<AboutBlockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null); // block id being saved
  const [editId, setEditId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Record<string, unknown>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Auth guard
  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user || session.user.role !== 'ADMIN') router.replace('/');
  }, [session, status, router]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  };

  // Load all blocks (including hidden)
  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/about-blocks?all=1');
      const data: AboutBlockRow[] = await res.json();
      setBlocks(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Open edit modal
  const openEdit = (block: AboutBlockRow) => {
    setEditId(block.id);
    setEditData(block.data);
  };

  const closeEdit = () => { setEditId(null); setEditData({}); };

  // Save edit
  const saveEdit = async () => {
    if (!editId) return;
    setSaving(editId);
    try {
      const res = await fetch('/api/about-blocks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editId, data: editData }),
      });
      if (!res.ok) throw new Error();
      const updated: AboutBlockRow = await res.json();
      setBlocks((bs) => bs.map((b) => (b.id === editId ? updated : b)));
      closeEdit();
      showToast('Сохранено ✓');
    } catch { showToast('Ошибка сохранения'); }
    finally { setSaving(null); }
  };

  // Toggle visibility
  const toggleVisible = async (block: AboutBlockRow) => {
    const res = await fetch('/api/about-blocks', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: block.id, visible: !block.visible }),
    });
    if (res.ok) {
      const updated: AboutBlockRow = await res.json();
      setBlocks((bs) => bs.map((b) => (b.id === block.id ? updated : b)));
    }
  };

  // Delete block
  const deleteBlock = async (id: string) => {
    if (!confirm('Удалить блок?')) return;
    await fetch('/api/about-blocks', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    setBlocks((bs) => bs.filter((b) => b.id !== id));
    showToast('Блок удалён');
  };

  // Move block up/down
  const move = async (id: string, dir: -1 | 1) => {
    const idx = blocks.findIndex((b) => b.id === id);
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= blocks.length) return;
    const newBlocks = [...blocks];
    [newBlocks[idx], newBlocks[newIdx]] = [newBlocks[newIdx], newBlocks[idx]];
    // Update positions
    const updated = newBlocks.map((b, i) => ({ ...b, position: i }));
    setBlocks(updated);
    await Promise.all([
      fetch('/api/about-blocks', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: updated[idx].id, position: idx }) }),
      fetch('/api/about-blocks', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: updated[newIdx].id, position: newIdx }) }),
    ]);
  };

  // Add new block
  const addBlock = async (type: BlockType) => {
    const defaults = BLOCK_DEFAULTS[type];
    const res = await fetch('/api/about-blocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, data: defaults }),
    });
    if (res.ok) {
      const newBlock: AboutBlockRow = await res.json();
      setBlocks((bs) => [...bs, newBlock]);
      setAddOpen(false);
      openEdit(newBlock);
      showToast(`Блок «${BLOCK_LABELS[type]}» добавлен`);
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#07090f]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  const editBlock = blocks.find((b) => b.id === editId);

  return (
    <div className="min-h-screen bg-[#07090f] text-white">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] rounded-xl border border-indigo-500/30 bg-indigo-500/20 px-5 py-3 text-sm font-semibold text-white backdrop-blur shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="sticky top-0 z-40 border-b border-white/06 bg-[#07090f]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-6 py-4">
          <button onClick={() => router.back()} className="text-neutral-500 hover:text-white transition-colors">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-bold">Контент сайта — О проекте</h1>
            <p className="text-xs text-neutral-600">Управление блоками страницы /about</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <a href="/about" target="_blank" className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1">
              Открыть страницу
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
            </a>
            <button
              onClick={() => setAddOpen(true)}
              className={btnPri + " bg-indigo-600 hover:bg-indigo-500"}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Добавить блок
            </button>
          </div>
        </div>
      </div>

      {/* Block list */}
      <div className="mx-auto max-w-4xl px-6 py-8">
        {blocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 text-4xl">📋</div>
            <p className="text-neutral-500">Блоков пока нет</p>
            <button onClick={() => setAddOpen(true)} className="mt-4 text-sm text-indigo-400 hover:text-indigo-300">Добавить первый блок</button>
          </div>
        ) : (
          <div className="space-y-2">
            {blocks.map((block, idx) => (
              <div
                key={block.id}
                className={`flex items-center gap-3 rounded-2xl border p-4 transition-all ${ block.visible ? 'border-white/08 bg-white/[0.025]' : 'border-white/04 bg-white/[0.01] opacity-50' }`}
              >
                {/* Position arrows */}
                <div className="flex flex-col gap-0.5">
                  <button disabled={idx === 0} onClick={() => move(block.id, -1)} className="p-1 text-neutral-700 hover:text-white disabled:opacity-20 transition-colors">
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                  </button>
                  <button disabled={idx === blocks.length - 1} onClick={() => move(block.id, 1)} className="p-1 text-neutral-700 hover:text-white disabled:opacity-20 transition-colors">
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                </div>

                {/* Type badge */}
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/[0.04] text-lg">
                  {BLOCK_LABELS[block.type as BlockType]?.split(' ')[0]}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">{BLOCK_LABELS[block.type as BlockType]?.slice(2)}</div>
                  <div className="text-xs text-neutral-600 truncate">
                    {block.type === 'hero' && ((block.data as unknown as HeroData).title || '—')}
                    {block.type === 'gallery' && `${((block.data as unknown as GalleryData).items ?? []).length} медиафайлов`}
                    {block.type === 'bento' && `${((block.data as unknown as BentoData).items ?? []).length} карточек`}
                    {block.type === 'stats' && `${((block.data as unknown as StatsData).items ?? []).length} показателей`}
                    {block.type === 'timeline' && `${((block.data as unknown as TimelineData).items ?? []).length} этапов`}
                    {block.type === 'team' && `${((block.data as unknown as TeamData).members ?? []).length} участников`}
                    {block.type === 'cta' && ((block.data as unknown as CtaData).title || '—')}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  {/* Visibility */}
                  <button onClick={() => toggleVisible(block)} title={block.visible ? 'Скрыть' : 'Показать'}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${ block.visible ? 'bg-green-500/15 text-green-400' : 'bg-white/05 text-neutral-600' }`}
                  >
                    {block.visible ? '● Виден' : '○ Скрыт'}
                  </button>

                  {/* Edit */}
                  <button onClick={() => openEdit(block)}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-white/70 hover:border-indigo-500/40 hover:text-indigo-300 transition-colors"
                  >
                    Редактировать
                  </button>

                  {/* Delete */}
                  <button onClick={() => deleteBlock(block.id)}
                    className="rounded-lg px-2 py-1.5 text-neutral-700 hover:text-red-400 transition-colors"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editId && editBlock && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-8" style={{ background: 'rgba(0,0,0,.75)', backdropFilter: 'blur(8px)' }}>
          <div className="relative w-full max-w-2xl mx-4 rounded-2xl border border-white/10 bg-[#0d0f18] p-6 shadow-2xl">
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">{BLOCK_LABELS[editBlock.type as BlockType]}</h2>
                <p className="text-xs text-neutral-600">ID: {editBlock.id}</p>
              </div>
              <button onClick={closeEdit} className="text-neutral-600 hover:text-white text-xl transition-colors">×</button>
            </div>

            {/* Form */}
            <div className="max-h-[60vh] overflow-y-auto pr-1">
              <BlockEditorForm
                block={{ ...editBlock, data: editData }}
                onChange={(d) => setEditData(d as Record<string, unknown>)}
              />
            </div>

            {/* Footer */}
            <div className="mt-6 flex items-center justify-end gap-3 border-t border-white/06 pt-4">
              <button onClick={closeEdit} className="rounded-xl border border-white/10 px-5 py-2 text-sm text-neutral-500 hover:text-white transition-colors">
                Отмена
              </button>
              <button
                onClick={saveEdit}
                disabled={saving === editId}
                className="flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-5 py-2 text-sm font-semibold text-white transition-colors"
              >
                {saving === editId ? (
                  <><div className="h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" />Сохранение...</>
                ) : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add block modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,.75)', backdropFilter: 'blur(8px)' }}>
          <div className="w-full max-w-md mx-4 rounded-2xl border border-white/10 bg-[#0d0f18] p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold">Выберите тип блока</h2>
              <button onClick={() => setAddOpen(false)} className="text-neutral-600 hover:text-white text-xl">×</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {BLOCK_TYPES.map((type) => (
                <button
                  key={type}
                  onClick={() => addBlock(type)}
                  className="flex items-center gap-2 rounded-xl border border-white/07 bg-white/[0.025] p-3 text-sm font-medium hover:border-indigo-500/40 hover:bg-indigo-500/10 transition-all text-left"
                >
                  <span className="text-lg">{BLOCK_LABELS[type].split(' ')[0]}</span>
                  <span className="text-white/80">{BLOCK_LABELS[type].slice(2)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
