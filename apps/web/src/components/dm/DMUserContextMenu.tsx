"use client";

// FIX-DM: контекстное меню по ПКМ на нике в личных сообщениях:
// чёрный список, запрет голосовых и видеосообщений, вложения чата и автоответ.
// Дизайн повторяет UserContextMenu из connect (w-60, rounded-xl, animate-fade-in).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import InfoTooltip from "@/components/ui/InfoTooltip";

export interface DmSettings {
  blacklisted: boolean;
  voiceBan: boolean;
  autoReplyEnabled: boolean;
  autoReplyText: string;
}

export const DM_SETTINGS_DEFAULTS: DmSettings = {
  blacklisted: false,
  voiceBan: false,
  autoReplyEnabled: false,
  autoReplyText: "",
};

const ITEM =
  "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-left transition-colors text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/10";
const DANGER =
  "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-left transition-colors text-red-500 hover:bg-red-500/10";

function Divider() {
  return <div className="my-1 h-px bg-neutral-200 dark:bg-white/10" />;
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span
      className={`ml-auto w-8 h-[18px] rounded-full relative transition-colors flex-shrink-0 ${
        on ? "bg-violet-500 dark:bg-cyan-400" : "bg-neutral-300 dark:bg-white/20"
      }`}
      aria-hidden
    >
      <span
        className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-all ${
          on ? "left-[16px]" : "left-[2px]"
        }`}
      />
    </span>
  );
}

/* ── Контекстное меню ── */
export default function DMUserContextMenu({
  x, y, name, settings, onToggleBlacklist, onToggleVoiceBan, onShowAttachments, onShowAutoReply, onClose,
}: {
  x: number;
  y: number;
  name: string;
  settings: DmSettings;
  onToggleBlacklist: () => void;
  onToggleVoiceBan: () => void;
  onShowAttachments: () => void;
  onShowAutoReply: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Не даём меню вылезти за край экрана.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth || 240;
    const h = el.offsetHeight || 200;
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - h - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      style={{ position: "fixed", left: pos.left, top: pos.top }}
      className="z-[90] w-64 rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-2xl p-1.5 select-none animate-fade-in"
      onContextMenu={(e) => e.preventDefault()}
    >
      <p className="px-3 pt-1.5 pb-1 text-[11px] font-medium text-neutral-400 truncate">{name}</p>

      <button type="button" className={ITEM} onClick={onShowAttachments}>
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
        Вложения и материалы чата
      </button>

      <button type="button" className={ITEM} onClick={onShowAutoReply}>
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        Автоответ…
        {settings.autoReplyEnabled && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />}
      </button>

      <Divider />

      <button type="button" className={ITEM} onClick={onToggleVoiceBan}>
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
        </svg>
        {/* Тот же запрет теперь закрывает и видеосообщения: человек запрещал не
            формат файла, а необходимость слушать вместо чтения. */}
        Запрет голосовых и видео
        <Toggle on={settings.voiceBan} />
      </button>

      <Divider />

      <button type="button" className={settings.blacklisted ? ITEM : DANGER} onClick={onToggleBlacklist}>
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <circle cx="12" cy="12" r="10" />
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        </svg>
        {settings.blacklisted ? "Убрать из чёрного списка" : "В чёрный список"}
      </button>
      {settings.blacklisted && (
        <p className="px-3 pb-1.5 pt-0.5 text-[10px] leading-snug text-red-400/80">
          Личные сообщения в обе стороны заблокированы
        </p>
      )}
    </div>,
    document.body,
  );
}

/* ── Модалка вложений ── */
interface AttachmentItem {
  messageId: string;
  userName: string;
  createdAt: string;
  url: string;
  name?: string;
  isImage?: boolean;
  isVideo?: boolean;
  isVoice?: boolean;
}

type AttachmentsTab = "media" | "voice" | "files";

// FIX-DM: вынесено из рендера модалки (react-hooks/static-components).
function TabBtn({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
        active
          ? "bg-violet-500/15 dark:bg-cyan-400/15 text-violet-600 dark:text-cyan-300"
          : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/10"
      }`}
    >
      {label} <span className="opacity-60">{count}</span>
    </button>
  );
}

export function DMAttachmentsModal({ conversationId, peerName, onClose }: {
  conversationId: string;
  peerName: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<AttachmentItem[] | null>(null);
  const [tab, setTab] = useState<AttachmentsTab>("media");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/dm/${conversationId}/attachments`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => { if (!cancelled) setItems(d.items ?? []); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [conversationId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const media = (items ?? []).filter((i) => (i.isImage || i.isVideo) && !i.isVoice);
  const voice = (items ?? []).filter((i) => i.isVoice);
  const files = (items ?? []).filter((i) => !i.isImage && !i.isVideo && !i.isVoice);
  const active = tab === "media" ? media : tab === "voice" ? voice : files;

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-white/10">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white truncate">Вложения — {peerName}</h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/10 hover:text-neutral-800 dark:hover:text-white transition-colors" aria-label="Закрыть">
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-neutral-200 dark:border-white/10">
          <TabBtn label="Медиа" count={media.length} active={tab === "media"} onClick={() => setTab("media")} />
          <TabBtn label="Голосовые" count={voice.length} active={tab === "voice"} onClick={() => setTab("voice")} />
          <TabBtn label="Файлы" count={files.length} active={tab === "files"} onClick={() => setTab("files")} />
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {items === null ? (
            <p className="text-xs text-neutral-400 text-center py-8">Загрузка…</p>
          ) : active.length === 0 ? (
            <p className="text-xs text-neutral-400 text-center py-8">Здесь пока пусто</p>
          ) : tab === "media" ? (
            <div className="grid grid-cols-3 gap-2">
              {media.map((i, idx) => (
                <a key={`${i.messageId}-${idx}`} href={i.url} target="_blank" rel="noreferrer" className="relative aspect-square rounded-lg overflow-hidden bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 group">
                  {i.isVideo ? (
                    <>
                      <video src={i.url} muted className="w-full h-full object-cover" />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <svg width={20} height={20} viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
                      </span>
                    </>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={i.url} alt={i.name ?? ""} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                  )}
                </a>
              ))}
            </div>
          ) : tab === "voice" ? (
            <div className="space-y-2">
              {voice.map((i, idx) => (
                <div key={`${i.messageId}-${idx}`} className="rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 p-2.5">
                  <p className="text-[11px] text-neutral-400 mb-1.5">{i.userName} · {new Date(i.createdAt).toLocaleString("ru-RU")}</p>
                  <audio src={i.url} controls preload="none" className="w-full h-8" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1.5">
              {files.map((i, idx) => (
                <a key={`${i.messageId}-${idx}`} href={i.url} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-neutral-200 dark:border-white/10 hover:bg-neutral-100 dark:hover:bg-white/10 transition-colors">
                  <svg className="w-4 h-4 flex-shrink-0 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                    <path d="M13 2v7h7" />
                  </svg>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-neutral-800 dark:text-neutral-200 truncate">{i.name || i.url.split("/").pop()}</span>
                    <span className="block text-[10px] text-neutral-400 truncate">{i.userName} · {new Date(i.createdAt).toLocaleDateString("ru-RU")}</span>
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Модалка автоответа ── */
export function DMAutoReplyModal({ peerName, settings, onSave, onClose }: {
  peerName: string;
  settings: DmSettings;
  onSave: (patch: { autoReplyEnabled: boolean; autoReplyText: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [enabled, setEnabled] = useState(settings.autoReplyEnabled);
  const [text, setText] = useState(settings.autoReplyText);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave({ autoReplyEnabled: enabled && !!text.trim(), autoReplyText: text.trim() });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 dark:border-white/10">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
            Автоответ для {peerName}{" "}
            <InfoTooltip
              side="bottom"
              text="Уходит сам в ответ на входящее сообщение, но не чаще раза в час — даже если вам напишут подряд несколько раз."
            />
          </h3>
        </div>
        <div className="p-4 space-y-3">
          <button type="button" onClick={() => setEnabled((v) => !v)} className="w-full flex items-center gap-2.5 text-[13px] text-neutral-700 dark:text-neutral-200">
            Включить автоответ
            <Toggle on={enabled} />
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 500))}
            rows={3}
            placeholder="Например: Сейчас не могу ответить, напишу позже"
            className="w-full rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5 px-3 py-2 text-[13px] text-neutral-800 dark:text-neutral-100 placeholder:text-neutral-400 resize-none focus:outline-none focus:ring-2 focus:ring-violet-500 dark:focus:ring-cyan-400"
          />
          <p className="text-right text-[10px] text-neutral-400">{text.length}/500</p>
        </div>
        <div className="flex justify-end gap-2 px-4 pb-4">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/10 transition-colors">Отмена</button>
          <button type="button" onClick={() => { void handleSave(); }} disabled={saving || (enabled && !text.trim())} className="px-4 py-1.5 rounded-lg text-xs font-medium bg-violet-500 dark:bg-cyan-500 text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity">
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
