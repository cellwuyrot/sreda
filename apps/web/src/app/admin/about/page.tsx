
"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import Spinner from "@/components/ui/Spinner";
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
  AppsData,
  AppItem,
  AppPlatform,
} from "@/lib/aboutBlocks";
import { BLOCK_DEFAULTS, BLOCK_LABELS, BLOCK_TYPES } from "@/lib/aboutBlocks";

// ─── tiny UI helpers ──────────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder-neutral-600 focus:border-indigo-500/60 focus:outline-none transition-colors";
const labelCls =
  "block mb-1 text-[11px] font-semibold uppercase tracking-widest text-neutral-500";

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

// ─── Block-specific visual editors ──────────────────────────────────────────

function HeroEditor({ data, onChange }: { data: HeroData; onChange: (d: HeroData) => void }) {
  const upd = (patch: Partial<HeroData>) => onChange({ ...data, ...patch });
  return (
    <>
      <Field label="Badge (верхняя строка-метка)">
        <Inp value={data.badge} onChange={(v) => upd({ badge: v })} placeholder="Платформа открыта" />
      </Field>
      <Field label="Главный заголовок">
        <Inp value={data.title} onChange={(v) => upd({ title: v })} placeholder="TRIOZ" />
      </Field>
      <Field label="Подзаголовок">
        <Inp value={data.subtitle} onChange={(v) => upd({ subtitle: v })} placeholder="Экосистема проектов" />
      </Field>
      <Field label="Описание (краткий текст)">
        <TextArea value={data.description} onChange={(v) => upd({ description: v })} rows={3} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Кнопка 1 — текст">
          <Inp value={data.primaryCta?.label} onChange={(v) => upd({ primaryCta: { ...data.primaryCta!, label: v } })} placeholder="Начать" />
        </Field>
        <Field label="Кнопка 1 — ссылка (href)">
          <Inp value={data.primaryCta?.href} onChange={(v) => upd({ primaryCta: { ...data.primaryCta!, href: v } })} placeholder="/connect" />
        </Field>
        <Field label="Кнопка 2 — текст">
          <Inp value={data.secondaryCta?.label} onChange={(v) => upd({ secondaryCta: { ...data.secondaryCta, label: v } })} />
        </Field>
        <Field label="Кнопка 2 — href или video для скролла к видео">
          <Inp
            value={data.secondaryCta?.action === "video" ? "video" : data.secondaryCta?.href ?? ""}
            onChange={(v) =>
              upd({
                secondaryCta: {
                  label: data.secondaryCta?.label ?? "",
                  ...(v === "video" ? { action: "video" } : { href: v }),
                },
              })
            }
            placeholder="/projects или video"
          />
        </Field>
      </div>
    </>
  );
}

function VideoEditor({ data, onChange }: { data: VideoData; onChange: (d: VideoData) => void }) {
  const upd = (patch: Partial<VideoData>) => onChange({ ...data, ...patch });
  return (
    <>
      <Field label="YouTube ID (например: dQw4w9WgXcQ)">
        <Inp value={data.youtubeId} onChange={(v) => upd({ youtubeId: v, url: "" })} placeholder="dQw4w9WgXcQ" />
      </Field>
      <Field label="Или прямой URL видеофайла (.mp4 / .webm)">
        <Inp value={data.url} onChange={(v) => upd({ url: v, youtubeId: "" })} placeholder="/uploads/about/video.mp4" />
      </Field>
      <Field label="Подпись под видео">
        <Inp value={data.title} onChange={(v) => upd({ title: v })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Длительность (для отображения)">
          <Inp value={data.duration} onChange={(v) => upd({ duration: v })} placeholder="3:47" />
        </Field>
        <Field label="Тег (emoji + текст)">
          <Inp value={data.tag} onChange={(v) => upd({ tag: v })} placeholder="🎬 Трейлер" />
        </Field>
      </div>
    </>
  );
}

function StatsEditor({ data, onChange }: { data: StatsData; onChange: (d: StatsData) => void }) {
  const items = data.items ?? [];
  const updItem = (i: number, patch: Partial<StatsItem>) =>
    onChange({ ...data, items: items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  return (
    <>
      <p className="mb-3 text-xs text-neutral-600">Цифры и подписи под ними (например: 1200+ / участников)</p>
      {items.map((it, i) => (
        <div key={i} className="flex gap-2 items-end mb-2">
          <div className="w-32">
            <Field label={`Значение ${i + 1}`}>
              <Inp value={it.value} onChange={(v) => updItem(i, { value: v })} placeholder="1200+" />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Подпись">
              <Inp value={it.label} onChange={(v) => updItem(i, { label: v })} placeholder="участников" />
            </Field>
          </div>
          <button
            className="mb-4 px-2 text-red-500 hover:text-red-400 text-xl leading-none"
            onClick={() => onChange({ ...data, items: items.filter((_, j) => j !== i) })}
          >×</button>
        </div>
      ))}
      <button
        className="mt-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        onClick={() => onChange({ ...data, items: [...items, { value: "", label: "" }] })}
      >+ Добавить показатель</button>
    </>
  );
}

function GalleryEditor({
  data, onChange, blockId,
}: { data: GalleryData; onChange: (d: GalleryData) => void; blockId: string }) {
  const items = data.items ?? [];
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/about-media", { method: "POST", body: fd });
      if (!res.ok) throw new Error("upload failed");
      const json = (await res.json()) as { url: string; mediaType: string };
      const newItem: GalleryItem = {
        id: Date.now().toString(),
        mediaType: json.mediaType as GalleryItem["mediaType"],
        url: json.url,
        caption: file.name.replace(/\.[^.]+$/, ""),
      };
      onChange({ ...data, items: [...items, newItem] });
    } catch {
      alert("Ошибка загрузки файла");
    } finally {
      setUploading(false);
    }
  };

  const updItem = (id: string, patch: Partial<GalleryItem>) =>
    onChange({ ...data, items: items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  const removeItem = (id: string) =>
    onChange({ ...data, items: items.filter((it) => it.id !== id) });

  // blockId used to scope uploads if needed
  void blockId;

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Заголовок галереи">
          <Inp value={data.title} onChange={(v) => onChange({ ...data, title: v })} />
        </Field>
        <Field label="Подзаголовок">
          <Inp value={data.subtitle} onChange={(v) => onChange({ ...data, subtitle: v })} />
        </Field>
      </div>

      {/* Drag & Drop upload zone */}
      <div
        className="mb-4 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/10 p-6 cursor-pointer hover:border-indigo-500/40 transition-colors"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) upload(f);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          hidden
          accept="image/*,video/*,.gif"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
        />
        {uploading ? (
          <div className="flex items-center gap-2 text-sm text-indigo-400">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
            Загружаем...
          </div>
        ) : (
          <>
            <div className="mb-2 text-2xl">📁</div>
            <p className="text-sm text-neutral-500">Перетащите файл или нажмите для выбора</p>
            <p className="text-xs text-neutral-700 mt-1">JPG, PNG, WebP, GIF, MP4, WebM · до 200 MB</p>
          </>
        )}
      </div>

      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
            <div className="h-14 w-20 flex-shrink-0 overflow-hidden rounded-md bg-neutral-900">
              {item.mediaType === "video" ? (
                <video src={item.url} className="h-full w-full object-cover" muted />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.url} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="flex-1 min-w-0 grid grid-cols-2 gap-2">
              <input
                className={inputCls + " text-xs"}
                value={item.caption ?? ""}
                placeholder="Подпись"
                onChange={(e) => updItem(item.id, { caption: e.target.value })}
              />
              <input
                className={inputCls + " text-xs"}
                value={item.tag ?? ""}
                placeholder="Тег (необязательно)"
                onChange={(e) => updItem(item.id, { tag: e.target.value })}
              />
            </div>
            <button
              className="text-red-500 hover:text-red-400 text-xl leading-none self-start"
              onClick={() => removeItem(item.id)}
            >×</button>
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
        <Field label="Заголовок раздела">
          <Inp value={data.title} onChange={(v) => onChange({ ...data, title: v })} />
        </Field>
        <Field label="Подзаголовок">
          <Inp value={data.subtitle} onChange={(v) => onChange({ ...data, subtitle: v })} />
        </Field>
      </div>
      {items.map((it, i) => (
        <div key={it.key} className="mb-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-white">{it.icon} {it.title || "Карточка"}</span>
            <button
              className="text-red-500 hover:text-red-400 text-sm"
              onClick={() => onChange({ ...data, items: items.filter((_, j) => j !== i) })}
            >Удалить</button>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <Field label="Иконка (emoji)">
              <Inp value={it.icon} onChange={(v) => updItem(i, { icon: v })} placeholder="💬" />
            </Field>
            <Field label="Заголовок карточки">
              <Inp value={it.title} onChange={(v) => updItem(i, { title: v })} />
            </Field>
            <Field label="Цвет (hex)">
              <div className="flex items-center gap-2">
                <Inp value={it.color} onChange={(v) => updItem(i, { color: v })} placeholder="#6366f1" />
                <div
                  className="h-7 w-7 flex-shrink-0 rounded-lg border border-white/10"
                  style={{ background: it.color ?? "#6366f1" }}
                />
              </div>
            </Field>
          </div>
          <Field label="Описание">
            <TextArea rows={2} value={it.description} onChange={(v) => updItem(i, { description: v })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Ссылка (href)">
              <Inp value={it.href} onChange={(v) => updItem(i, { href: v })} placeholder="/connect" />
            </Field>
            <Field label="Ширина">
              <button
                className={`w-full rounded-lg px-3 py-2 text-xs font-semibold border transition-colors ${
                  it.wide
                    ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-300"
                    : "border-white/10 text-neutral-500"
                }`}
                onClick={() => updItem(i, { wide: !it.wide })}
              >
                {it.wide ? "✓ Широкая (2 колонки)" : "Обычная (1 колонка)"}
              </button>
            </Field>
          </div>
        </div>
      ))}
      <button
        className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        onClick={() =>
          onChange({
            ...data,
            items: [
              ...items,
              { key: Date.now().toString(), icon: "✨", title: "Новый раздел", description: "", color: "#6366f1" },
            ],
          })
        }
      >+ Добавить карточку</button>
    </>
  );
}

function TimelineEditor({
  data, onChange,
}: { data: TimelineData; onChange: (d: TimelineData) => void }) {
  const items = data.items ?? [];
  const updItem = (i: number, patch: Partial<TimelineItem>) =>
    onChange({ ...data, items: items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  return (
    <>
      <Field label="Заголовок секции">
        <Inp value={data.title} onChange={(v) => onChange({ ...data, title: v })} />
      </Field>
      {items.map((it, i) => (
        <div key={i} className="mb-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
          <div className="grid grid-cols-4 gap-2 mb-2">
            <Field label="Год">
              <Inp value={it.year} onChange={(v) => updItem(i, { year: v })} placeholder="2024" />
            </Field>
            <div className="col-span-2">
              <Field label="Заголовок этапа">
                <Inp value={it.title} onChange={(v) => updItem(i, { title: v })} />
              </Field>
            </div>
            <Field label="Цвет">
              <div className="flex items-center gap-2">
                <Inp value={it.color} onChange={(v) => updItem(i, { color: v })} placeholder="#6366f1" />
                <div
                  className="h-7 w-7 flex-shrink-0 rounded-lg border border-white/10"
                  style={{ background: it.color ?? "#6366f1" }}
                />
              </div>
            </Field>
          </div>
          <Field label="Описание">
            <TextArea rows={2} value={it.description} onChange={(v) => updItem(i, { description: v })} />
          </Field>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-neutral-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!!it.current}
                onChange={(e) => updItem(i, { current: e.target.checked })}
                className="accent-indigo-500"
              />
              Текущий этап (пульсирующий маркер)
            </label>
            <button
              className="text-red-500 hover:text-red-400 text-xs"
              onClick={() => onChange({ ...data, items: items.filter((_, j) => j !== i) })}
            >Удалить</button>
          </div>
        </div>
      ))}
      <button
        className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        onClick={() =>
          onChange({
            ...data,
            items: [
              ...items,
              { year: new Date().getFullYear().toString(), title: "Новый этап", color: "#6366f1" },
            ],
          })
        }
      >+ Добавить этап</button>
    </>
  );
}

function TeamEditor({ data, onChange }: { data: TeamData; onChange: (d: TeamData) => void }) {
  const members = data.members ?? [];
  const updMember = (i: number, patch: Partial<TeamMember>) =>
    onChange({ ...data, members: members.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  return (
    <>
      <Field label="Заголовок секции">
        <Inp value={data.title} onChange={(v) => onChange({ ...data, title: v })} />
      </Field>
      {members.map((m, i) => (
        <div key={m.id} className="mb-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-white">{m.emoji ?? "👤"} {m.name || "Участник"}</span>
            <button
              className="text-red-500 hover:text-red-400 text-sm"
              onClick={() => onChange({ ...data, members: members.filter((_, j) => j !== i) })}
            >Удалить</button>
          </div>
          <div className="grid grid-cols-4 gap-2 mb-2">
            <Field label="Emoji">
              <Inp value={m.emoji} onChange={(v) => updMember(i, { emoji: v })} placeholder="👤" />
            </Field>
            <div className="col-span-2">
              <Field label="Имя">
                <Inp value={m.name} onChange={(v) => updMember(i, { name: v })} placeholder="Иван Иванов" />
              </Field>
            </div>
            <Field label="Роль">
              <Inp value={m.role} onChange={(v) => updMember(i, { role: v })} placeholder="Разработчик" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Аватар URL (необязательно)">
              <Inp value={m.avatarUrl} onChange={(v) => updMember(i, { avatarUrl: v })} placeholder="/uploads/..." />
            </Field>
            <Field label="Цвет">
              <div className="flex items-center gap-2">
                <Inp value={m.color} onChange={(v) => updMember(i, { color: v })} placeholder="#6366f1" />
                <div
                  className="h-7 w-7 flex-shrink-0 rounded-lg border border-white/10"
                  style={{ background: m.color ?? "#6366f1" }}
                />
              </div>
            </Field>
          </div>
        </div>
      ))}
      <button
        className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors mr-4"
        onClick={() =>
          onChange({
            ...data,
            members: [
              ...members,
              { id: Date.now().toString(), name: "Новый участник", role: "", emoji: "👤", color: "#6366f1" },
            ],
          })
        }
      >+ Добавить участника</button>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Field label="Текст кнопки &quot;Присоединиться&quot;">
          <Inp value={data.joinLabel} onChange={(v) => onChange({ ...data, joinLabel: v })} placeholder="Присоединиться" />
        </Field>
        <Field label="Ссылка кнопки">
          <Inp value={data.joinHref} onChange={(v) => onChange({ ...data, joinHref: v })} placeholder="/connect" />
        </Field>
      </div>
    </>
  );
}

function CtaEditor({ data, onChange }: { data: CtaData; onChange: (d: CtaData) => void }) {
  const upd = (patch: Partial<CtaData>) => onChange({ ...data, ...patch });
  return (
    <>
      <Field label="Главный заголовок CTA">
        <Inp value={data.title} onChange={(v) => upd({ title: v })} placeholder="Станьте частью TRIOZ" />
      </Field>
      <Field label="Подзаголовок">
        <Inp value={data.subtitle} onChange={(v) => upd({ subtitle: v })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Кнопка 1 — текст">
          <Inp value={data.primaryCta?.label} onChange={(v) => upd({ primaryCta: { ...data.primaryCta!, label: v } })} />
        </Field>
        <Field label="Кнопка 1 — ссылка">
          <Inp value={data.primaryCta?.href} onChange={(v) => upd({ primaryCta: { ...data.primaryCta!, href: v } })} placeholder="/auth/signin" />
        </Field>
        <Field label="Кнопка 2 — текст">
          <Inp value={data.secondaryCta?.label} onChange={(v) => upd({ secondaryCta: { ...data.secondaryCta!, label: v } })} />
        </Field>
        <Field label="Кнопка 2 — ссылка">
          <Inp value={data.secondaryCta?.href} onChange={(v) => upd({ secondaryCta: { ...data.secondaryCta!, href: v } })} placeholder="/projects" />
        </Field>
      </div>
    </>
  );
}


const APP_PLATFORMS: { value: AppPlatform; label: string }[] = [
  { value: 'android', label: 'Android (.apk)' },
  { value: 'windows', label: 'Windows (.exe / .msi)' },
  { value: 'macos',   label: 'macOS (.dmg / .pkg)' },
  { value: 'linux',   label: 'Linux (.deb / .AppImage)' },
];

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AppItemEditor({
  app,
  index,
  onChange,
  onDelete,
}: {
  app: AppItem;
  index: number;
  onChange: (patch: Partial<AppItem>) => void;
  onDelete: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    setUploadError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/about-apps-upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const e = (await res.json()) as { error?: string };
        throw new Error(e.error ?? 'Upload failed');
      }
      const json = (await res.json()) as { url: string; fileName: string; fileSize: number };
      onChange({ fileUrl: json.url, fileName: json.fileName, fileSize: json.fileSize });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async () => {
    if (!app.fileUrl) return;
    try {
      await fetch('/api/about-apps-upload', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileUrl: app.fileUrl }),
      });
    } catch { /* soft fail */ }
    onChange({ fileUrl: undefined, fileName: undefined, fileSize: undefined });
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-neutral-500 uppercase tracking-widest">
          Приложение {index + 1}
        </span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={app.active}
              onChange={(e) => onChange({ active: e.target.checked })}
              className="h-3.5 w-3.5 rounded accent-indigo-500"
            />
            <span className="text-xs text-neutral-400">Активно</span>
          </label>
          <button
            className="text-red-500 hover:text-red-400 text-sm transition-colors"
            onClick={onDelete}
          >
            Удалить
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Платформа">
          <select
            className={inputCls}
            value={app.platform}
            onChange={(e) => onChange({ platform: e.target.value as AppPlatform })}
          >
            {APP_PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Название приложения">
          <Inp value={app.name} onChange={(v) => onChange({ name: v })} placeholder="TZ.Connect" />
        </Field>
        <Field label="Версия">
          <Inp value={app.version} onChange={(v) => onChange({ version: v })} placeholder="1.0.0" />
        </Field>
      </div>

      <Field label="Описание (показывается на /about)">
        <TextArea
          value={app.description}
          onChange={(v) => onChange({ description: v })}
          rows={2}
          placeholder="Краткое описание приложения..."
        />
      </Field>

      {/* File section */}
      <div className="mt-1">
        <label className={labelCls}>Установочный файл (.exe / .apk / .dmg / .deb / .AppImage)</label>
        {app.fileUrl ? (
          <div className="flex items-center gap-3 rounded-lg border border-green-500/25 bg-green-500/5 px-3 py-2">
            <svg className="h-4 w-4 text-green-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-green-400 font-medium truncate">{app.fileName ?? app.fileUrl}</p>
              {app.fileSize && (
                <p className="text-[10px] text-neutral-600">{formatSize(app.fileSize)}</p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                Заменить
              </button>
              <button
                className="text-xs text-red-500 hover:text-red-400 transition-colors"
                onClick={removeFile}
                disabled={uploading}
              >
                Удалить
              </button>
            </div>
          </div>
        ) : (
          <button
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 bg-white/[0.02] py-3 text-sm text-neutral-500 hover:border-indigo-500/40 hover:text-indigo-400 transition-colors"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <><span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /> Загрузка...</>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 16v-8m0 0l-3 3m3-3l3 3M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2" />
                </svg>
                Загрузить установочник
              </>
            )}
          </button>
        )}
        {uploadError && (
          <p className="mt-1 text-xs text-red-400">{uploadError}</p>
        )}
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept=".exe,.apk,.dmg,.deb,.AppImage,.pkg,.msi"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

function AppsEditor({ data, onChange }: { data: AppsData; onChange: (d: AppsData) => void }) {
  const items = data.items ?? [];

  const updItem = (i: number, patch: Partial<AppItem>) =>
    onChange({ ...data, items: items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });

  const addItem = () => {
    const newItem: AppItem = {
      id: Date.now().toString(),
      platform: 'android',
      name: 'TZ.Connect',
      version: '1.0.0',
      description: '',
      active: true,
    };
    onChange({ ...data, items: [...items, newItem] });
  };

  const removeItem = (i: number) =>
    onChange({ ...data, items: items.filter((_, j) => j !== i) });

  return (
    <>
      <Field label="Заголовок секции">
        <Inp value={data.title} onChange={(v) => onChange({ ...data, title: v })} placeholder="Приложения TRIOZ" />
      </Field>
      <Field label="Подзаголовок">
        <TextArea
          value={data.subtitle}
          onChange={(v) => onChange({ ...data, subtitle: v })}
          rows={2}
          placeholder="Установите нативное приложение..."
        />
      </Field>

      <div className="my-4 border-t border-white/[0.06]" />

      <p className="mb-3 text-xs text-neutral-600">
        Добавьте приложения. Только активные приложения с загруженным файлом покажут кнопку «Скачать».
        Неактивные не отображаются на публичной странице.
      </p>

      {items.length === 0 && (
        <p className="mb-3 text-center text-sm text-neutral-700 rounded-xl border border-dashed border-white/10 py-6">
          Приложений пока нет. Нажмите «+ Добавить приложение».
        </p>
      )}

      {items.map((app, i) => (
        <AppItemEditor
          key={app.id}
          app={app}
          index={i}
          onChange={(patch) => updItem(i, patch)}
          onDelete={() => removeItem(i)}
        />
      ))}

      <button
        className="w-full mt-2 flex items-center justify-center gap-2 rounded-xl border border-dashed border-indigo-500/30 py-2.5 text-sm text-indigo-400 hover:border-indigo-500/60 hover:bg-indigo-500/5 transition-colors"
        onClick={addItem}
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        + Добавить приложение
      </button>
    </>
  );
}

// Dispatches the right form component based on block type
function BlockEditorForm({
  block,
  blockData,
  onChange,
}: {
  block: AboutBlockRow;
  blockData: unknown;
  onChange: (d: unknown) => void;
}) {
  const d = blockData;
  switch (block.type) {
    case "hero":
      return <HeroEditor data={d as HeroData} onChange={onChange as (d: HeroData) => void} />;
    case "video":
      return <VideoEditor data={d as VideoData} onChange={onChange as (d: VideoData) => void} />;
    case "stats":
      return <StatsEditor data={d as StatsData} onChange={onChange as (d: StatsData) => void} />;
    case "gallery":
      return (
        <GalleryEditor
          data={d as GalleryData}
          onChange={onChange as (d: GalleryData) => void}
          blockId={block.id}
        />
      );
    case "bento":
      return <BentoEditor data={d as BentoData} onChange={onChange as (d: BentoData) => void} />;
    case "timeline":
      return <TimelineEditor data={d as TimelineData} onChange={onChange as (d: TimelineData) => void} />;
    case "team":
      return <TeamEditor data={d as TeamData} onChange={onChange as (d: TeamData) => void} />;
    case "cta":
      return <CtaEditor data={d as CtaData} onChange={onChange as (d: CtaData) => void} />;
    case "apps":
      return <AppsEditor data={d as AppsData} onChange={onChange as (d: AppsData) => void} />;
    default:
      return <p className="text-neutral-500 text-sm">Редактор для этого типа блока не реализован.</p>;
  }
}

// ─── Toast ──────────────────────────────────────────────────────────────────

type ToastType = { msg: string; ok: boolean };

function Toast({ msg, ok }: ToastType) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className={`fixed bottom-6 right-6 z-50 rounded-xl px-5 py-3 text-sm font-medium text-white shadow-lg ${
        ok ? "bg-green-600" : "bg-red-500"
      }`}
    >
      {msg}
    </motion.div>
  );
}

// ─── Visual Edit Modal (replaces JSON textarea) ──────────────────────────────

interface EditModalProps {
  block: AboutBlockRow;
  onClose: () => void;
  onSave: (id: string, type: BlockType, data: unknown, visible: boolean) => Promise<void>;
}

function EditModal({ block, onClose, onSave }: EditModalProps) {
  const [type, setType] = useState<BlockType>(block.type);
  const [visible, setVisible] = useState(block.visible);
  // When type changes we reset data to defaults; otherwise start with block data
  const [blockData, setBlockData] = useState<unknown>(
    block.data ?? BLOCK_DEFAULTS[block.type],
  );
  const [saving, setSaving] = useState(false);

  const handleTypeChange = (t: BlockType) => {
    setType(t);
    setBlockData(BLOCK_DEFAULTS[t]);
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave(block.id, type, blockData, visible);
    setSaving(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      style={{ background: "rgba(0,0,0,.7)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="relative w-full max-w-2xl rounded-2xl border border-white/10 bg-neutral-900 p-6 shadow-2xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">✏️ Редактировать блок</h3>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 p-1.5 text-neutral-500 hover:text-white transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Type selector */}
        <div className="mb-5 flex items-center gap-3">
          <div className="flex-1">
            <label className={labelCls}>Тип блока</label>
            <select
              value={type}
              onChange={(e) => handleTypeChange(e.target.value as BlockType)}
              className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              {BLOCK_TYPES.map((t) => (
                <option key={t} value={t}>{BLOCK_LABELS[t]}</option>
              ))}
            </select>
          </div>

          {/* Visibility toggle */}
          <div>
            <label className={labelCls}>Показывать</label>
            <button
              onClick={() => setVisible((v) => !v)}
              className={`relative flex h-8 w-14 items-center rounded-full transition-colors ${
                visible ? "bg-indigo-600" : "bg-neutral-700"
              }`}
            >
              <span
                className={`absolute left-0.5 h-7 w-7 rounded-full bg-white shadow transition-transform ${
                  visible ? "translate-x-6" : ""
                }`}
              />
            </button>
          </div>
        </div>

        {/* Visual block editor — no JSON! */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <BlockEditorForm block={{ ...block, type }} blockData={blockData} onChange={setBlockData} />
        </div>

        {/* Footer buttons */}
        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 px-5 py-2.5 text-sm text-neutral-400 hover:text-white transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {saving ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Сохранение...
              </>
            ) : (
              "💾 Сохранить"
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Block card (row in the list) ────────────────────────────────────────────

interface BlockCardProps {
  block: AboutBlockRow;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleVisible: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function BlockCard({
  block, isFirst, isLast, onMoveUp, onMoveDown, onToggleVisible, onEdit, onDelete,
}: BlockCardProps) {
  const [icon, ...rest] = BLOCK_LABELS[block.type].split(" ");
  const name = rest.join(" ");
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-neutral-900 p-4"
    >
      {/* Up / Down */}
      <div className="flex flex-col gap-1">
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          title="Вверх"
          className="rounded-lg border border-white/10 p-1 text-neutral-500 hover:text-white disabled:opacity-20 transition-colors"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          title="Вниз"
          className="rounded-lg border border-white/10 p-1 text-neutral-500 hover:text-white disabled:opacity-20 transition-colors"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Label */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <span className="text-sm font-semibold text-white truncate">{name}</span>
        </div>
        <div className="mt-0.5 text-xs text-neutral-700">позиция {block.position}</div>
      </div>

      {/* Visible badge */}
      <span
        className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
          block.visible ? "bg-green-500/15 text-green-400" : "bg-neutral-800 text-neutral-500"
        }`}
      >
        {block.visible ? "Виден" : "Скрыт"}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onToggleVisible}
          className="rounded-xl border border-white/10 px-3 py-1.5 text-xs text-neutral-400 hover:text-white transition-colors"
        >
          {block.visible ? "Скрыть" : "Показать"}
        </button>
        <button
          onClick={onEdit}
          className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-300 hover:bg-indigo-500/20 transition-colors"
        >
          ✏️ Изменить
        </button>
        <button
          onClick={onDelete}
          className="rounded-xl border border-red-500/20 bg-red-500/10 px-2.5 py-1.5 text-red-400 hover:bg-red-500/20 transition-colors"
          title="Удалить блок"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </motion.div>
  );
}

// ─── Main admin page ──────────────────────────────────────────────────────────

export default function AdminAboutPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [blocks, setBlocks] = useState<AboutBlockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editBlock, setEditBlock] = useState<AboutBlockRow | null>(null);
  const [toast, setToast] = useState<ToastType | null>(null);
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState<BlockType>("hero");

  const showToast = useCallback((msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") router.push("/");
  }, [session, status, router]);

  const fetchBlocks = useCallback(async () => {
    try {
      const res = await fetch("/api/about-blocks?all=1");
      if (!res.ok) throw new Error();
      const data = (await res.json()) as AboutBlockRow[];
      setBlocks(data.sort((a, b) => a.position - b.position));
    } catch {
      showToast("Не удалось загрузить блоки", false);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchBlocks();
  }, [fetchBlocks]);

  const toggleVisible = async (block: AboutBlockRow) => {
    try {
      const res = await fetch("/api/about-blocks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: block.id, visible: !block.visible }),
      });
      if (!res.ok) throw new Error();
      const updated = (await res.json()) as AboutBlockRow;
      setBlocks((prev) => prev.map((b) => (b.id === block.id ? updated : b)));
      showToast(updated.visible ? "Блок показан" : "Блок скрыт", true);
    } catch {
      showToast("Ошибка при обновлении видимости", false);
    }
  };

  const saveBlock = async (id: string, type: BlockType, data: unknown, visible: boolean) => {
    try {
      const res = await fetch("/api/about-blocks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, type, data, visible }),
      });
      if (!res.ok) throw new Error();
      const updated = (await res.json()) as AboutBlockRow;
      setBlocks((prev) => prev.map((b) => (b.id === id ? updated : b)));
      showToast("Изменения сохранены", true);
    } catch {
      showToast("Ошибка при сохранении", false);
    }
  };

  const deleteBlock = async (block: AboutBlockRow) => {
    if (!confirm(`Удалить блок «${BLOCK_LABELS[block.type]}»? Это действие необратимо.`)) return;
    try {
      const res = await fetch("/api/about-blocks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: block.id }),
      });
      if (!res.ok) throw new Error();
      setBlocks((prev) => prev.filter((b) => b.id !== block.id));
      showToast("Блок удалён", true);
    } catch {
      showToast("Ошибка при удалении", false);
    }
  };

  const moveBlock = async (idx: number, dir: "up" | "down") => {
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= blocks.length) return;

    const sorted = [...blocks];
    const a = { ...sorted[idx], position: sorted[swapIdx].position };
    const b = { ...sorted[swapIdx], position: sorted[idx].position };
    sorted[idx] = a;
    sorted[swapIdx] = b;
    sorted.sort((x, y) => x.position - y.position);
    setBlocks(sorted);

    try {
      await Promise.all([
        fetch("/api/about-blocks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: a.id, position: a.position }),
        }),
        fetch("/api/about-blocks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: b.id, position: b.position }),
        }),
      ]);
    } catch {
      showToast("Ошибка при перестановке", false);
      fetchBlocks();
    }
  };

  const addBlock = async () => {
    setAdding(true);
    try {
      const res = await fetch("/api/about-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newType,
          data: BLOCK_DEFAULTS[newType] as unknown as Record<string, unknown>,
        }),
      });
      if (!res.ok) throw new Error();
      const created = (await res.json()) as AboutBlockRow;
      setBlocks((prev) => [...prev, created].sort((a, b) => a.position - b.position));
      showToast(`Блок «${BLOCK_LABELS[newType]}» добавлен`, true);
    } catch {
      showToast("Не удалось добавить блок", false);
    } finally {
      setAdding(false);
    }
  };

  if (status === "loading" || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950">
        <Spinner />
      </div>
    );
  }

  if (session?.user?.role !== "ADMIN") return null;

  return (
    <div className="min-h-screen bg-neutral-950 px-4 pb-24 pt-8">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/admin"
            className="mb-3 inline-flex items-center gap-1 text-sm text-indigo-400 hover:opacity-80 transition-opacity"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Админ-панель
          </Link>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white">📄 Блоки страницы О проекте</h1>
              <p className="mt-1 text-sm text-neutral-500">
                Редактируйте содержимое{" "}
                <Link href="/about" target="_blank" className="text-indigo-400 hover:underline">/about</Link>{" "}
                без написания кода. Нажмите <strong className="text-neutral-400">✏️ Изменить</strong> на нужном блоке.
              </p>
            </div>
            <Link
              href="/about"
              target="_blank"
              className="shrink-0 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-neutral-300 hover:bg-white/10 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Предпросмотр
            </Link>
          </div>
        </div>

        {/* Info tip */}
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-3">
          <span className="text-xl">💡</span>
          <p className="text-sm text-neutral-400">
            Блоки отображаются в том порядке, в котором расположены в списке. Используйте стрелки ↑↓ для изменения
            порядка. Скрытые блоки не показываются на странице, но не удаляются.
          </p>
        </div>

        {/* Block list */}
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {blocks.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-2xl border border-dashed border-white/10 p-10 text-center"
              >
                <p className="text-2xl mb-2">🧩</p>
                <p className="text-neutral-500">Блоков пока нет. Добавьте первый блок ниже.</p>
              </motion.div>
            ) : (
              blocks.map((block, idx) => (
                <BlockCard
                  key={block.id}
                  block={block}
                  isFirst={idx === 0}
                  isLast={idx === blocks.length - 1}
                  onMoveUp={() => moveBlock(idx, "up")}
                  onMoveDown={() => moveBlock(idx, "down")}
                  onToggleVisible={() => toggleVisible(block)}
                  onEdit={() => setEditBlock(block)}
                  onDelete={() => deleteBlock(block)}
                />
              ))
            )}
          </AnimatePresence>
        </div>

        {/* Add block */}
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-neutral-400">Добавить блок</h2>
          <div className="flex items-center gap-3">
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as BlockType)}
              className="flex-1 rounded-xl border border-white/10 bg-neutral-900 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              {BLOCK_TYPES.map((t) => (
                <option key={t} value={t}>{BLOCK_LABELS[t]}</option>
              ))}
            </select>
            <button
              onClick={addBlock}
              disabled={adding}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              {adding ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              )}
              Добавить
            </button>
          </div>
        </div>

        <p className="mt-4 text-xs text-neutral-700">
          Всего блоков: {blocks.length} · Видимых: {blocks.filter((b) => b.visible).length}
        </p>
      </div>

      {/* Edit modal */}
      <AnimatePresence>
        {editBlock && (
          <EditModal
            key={editBlock.id}
            block={editBlock}
            onClose={() => setEditBlock(null)}
            onSave={saveBlock}
          />
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>{toast && <Toast {...toast} />}</AnimatePresence>
    </div>
  );
}
