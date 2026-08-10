"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { DownloadIcon, FileIcon, XIcon } from "@/components/ui/ConnectIcons";
import { ArchiveIcon, FolderIcon, ImageIcon, PaperclipIcon, PdfIcon, PresentationIcon, SheetIcon, TrashIcon } from "@/components/ui/ConnectIconsExtra";
import { ModuleSettingsButton } from "@/components/connect/ModuleSettingsModal"; // FIX-DOCSGEAR
import { isAndroidShell } from "@/lib/shell"; // FIX-DOCS-DL
import { isDesktop } from "@/lib/desktop"; // FIX-DOCS-DL

type Uploader = { id: string; name: string; username?: string };
type WFile = { id: string; name: string; url: string; mime: string; size: number; createdAt: string; uploader: Uploader };

interface DocsPanelProps { channelId: string; channelName: string; }

/* FIX-UPLOAD: лимит должен совпадать с api/files (MAX_SIZE) и быть НЕ больше
   client_max_body_size в nginx.conf, иначе запрос обрывает прокси и клиент
   получает 413 без внятного тела ответа. */
const MAX_UPLOAD_MB = 25;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

const OFFICE_EXT = ["docx", "doc", "xlsx", "xls", "pptx", "ppt"];
/* FIX-DOCS: форматы, которые браузер показывает сам (после того как сервер стал
   отдавать им правильный Content-Type). Office-файлы сюда не входят: их
   рендерит только внешний сервис Microsoft, а он не видит приватный сервер. */
const INLINE_EXT = ["pdf", "txt", "csv", "json", "log", "md"];
const IMG_EXT = ["png", "jpg", "jpeg", "webp", "gif"];

function extOf(name: string) { return (name.split(".").pop() || "").toLowerCase(); }
function fmtSize(b: number) {
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
  return (b / 1024 / 1024).toFixed(1) + " MB";
}
// Единый стиль: вместо цветных эмодзи ОС — контурные SVG-иконки в стиле ConnectIcons.
function iconFor(ext: string, size = 22) {
  if (OFFICE_EXT.includes(ext)) {
    if (ext.startsWith("xls")) return <SheetIcon size={size} />;
    if (ext.startsWith("ppt")) return <PresentationIcon size={size} />;
    return <FileIcon size={size} />;
  }
  if (ext === "pdf") return <PdfIcon size={size} />;
  if (IMG_EXT.includes(ext)) return <ImageIcon size={size} />;
  if (ext === "zip") return <ArchiveIcon size={size} />;
  if (["txt", "csv", "rtf", "odt", "ods"].includes(ext)) return <FileIcon size={size} />;
  return <PaperclipIcon size={size} />;
}

export default function DocsPanel({ channelId, channelName }: DocsPanelProps) {
  const [files, setFiles] = useState<WFile[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  /* FIX-DOCSGEAR: право на настройки раздела — как в новостях и Q&A. */
  const [canModerate, setCanModerate] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<WFile | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/files?channelId=${channelId}`);
      if (res.ok) {
        const d = await res.json();
        setFiles(d.files || []);
        setCanEdit(!!d.canEdit);
        setCanModerate(!!d.canModerate);
        setCurrentUserId(d.currentUserId || "");
      }
    } finally { setLoading(false); }
  }, [channelId]);

  useEffect(() => { load(); }, [load]);

  const onPick = () => inputRef.current?.click();

  /* FIX-DOCS-DL: скачивание идёт по прямому URL с `?dl=1` — сервер отдаёт файл
     с заголовком `Content-Disposition: attachment` и настоящим именем.

     Предыдущий вариант через blob оказался хуже прежнего: в браузере он
     работал, но в десктоп-оболочке диалог выбора папки открывался, а файл до
     диска не доходил (скачивание blob-ссылки идёт мимо перехватчика
     `/uploads/`, который умеет `downloadURL`), а Android DownloadManager схему
     `blob:` не поддерживает вовсе. Теперь у каждой оболочки свой проверенный
     путь, и все три ведут к настоящему сетевому скачиванию. */
  const downloadHref = (f: WFile) =>
    `${f.url}${f.url.includes("?") ? "&" : "?"}dl=1&name=${encodeURIComponent(f.name)}`;

  const downloadFile = (f: WFile) => {
    const href = downloadHref(f);
    // Android: DownloadListener в WebView срабатывает только на настоящей
    // навигации, поэтому ссылку не «кликаем», а переходим по ней.
    if (isAndroidShell()) {
      // Именно assign, а не присваивание location.href: правило
      // react-hooks/immutability запрещает менять значения, объявленные вне
      // компонента, а вызов метода под запрет не попадает.
      window.location.assign(href);
      return;
    }
    // Десктоп-оболочка: обработчик открытия окна видит путь /uploads/ и
    // отдаёт файл через downloadURL — этот путь уже проверен на картинках.
    if (isDesktop()) {
      window.open(href, "_blank", "noopener");
      return;
    }
    const a = document.createElement("a");
    a.href = href;
    a.download = f.name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    /* FIX-UPLOAD: отсекаем слишком большой файл до отправки — раньше запрос
       уходил целиком и обрывался на прокси, а пользователь видел лишь
       «Ошибка загрузки» (тело ответа nginx — HTML, а не JSON). */
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`Файл «${file.name}» больше ${MAX_UPLOAD_MB} МБ`);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setUploading(true); setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("channelId", channelId);
      const res = await fetch("/api/files", { method: "POST", body: fd });
      if (res.ok) {
        const d = await res.json();
        setFiles((prev) => [d.file, ...prev]);
      } else if (res.status === 413) {
        /* FIX-UPLOAD: обрезал обратный прокси — у него свой лимит тела. */
        setError(`Сервер отклонил файл: превышен лимит размера (${MAX_UPLOAD_MB} МБ)`);
      } else if (res.status === 403) {
        setError("Недостаточно прав: загружать файлы могут владелец, администратор и модератор");
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error || `Ошибка загрузки (код ${res.status})`);
      }
    } catch {
      /* Сеть оборвалась или прокси закрыл соединение на большом теле. */
      setError("Не удалось отправить файл — проверьте соединение и размер");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onDelete = async (f: WFile) => {
    if (!(await confirmDialog({ message: "Удалить файл «" + f.name + "»?", confirmText: "Удалить", danger: true }))) return;
    const res = await fetch("/api/files/" + f.id, { method: "DELETE" });
    if (res.ok) setFiles((prev) => prev.filter((x) => x.id !== f.id));
  };

  const filtered = files.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary,#0f1117)] text-[var(--text-primary,#e6e6e6)]">
      {/* MOBILE-FIX: шапка «Документов» не влезала в 360dp одной строкой (название
          + поиск + кнопка загрузки) — поле поиска сжималось и вёрстка съезжала.
          На телефоне это две строки, поле растягивается, кнопки 44px. */}
      <div className="flex flex-col gap-2 px-4 py-3 border-b border-[var(--border,#222)] md:flex-row md:items-center md:justify-between md:gap-4">
        <span className="text-lg font-semibold flex items-center gap-2 min-w-0">
          <FolderIcon size={20} />
          <span className="truncate">{channelName}</span>
        </span>
        <div className="flex items-center gap-2 md:flex-shrink-0">
          {/* FIX-DOCSGEAR: та же шестерёнка, что в остальных рабочих модулях —
              кто видит раздел и кто может редактировать. */}
          {canModerate && <ModuleSettingsButton channelId={channelId} onSaved={load} />}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск…" className="flex-1 md:flex-none min-h-[44px] md:min-h-0 px-3 py-1.5 text-sm rounded-lg bg-[var(--bg-secondary,#1a1d27)] border border-[var(--border,#222)] outline-none focus:border-[var(--accent,#3b82f6)]" />
          {canEdit && (
            <>
              <input ref={inputRef} type="file" className="hidden" onChange={onUpload} />
              <button onClick={onPick} disabled={uploading} title={`Максимальный размер файла — ${MAX_UPLOAD_MB} МБ`} className="flex-shrink-0 min-h-[44px] md:min-h-0 px-3 py-1.5 text-sm rounded-lg bg-[var(--accent,#3b82f6)] text-white active:opacity-90 disabled:opacity-50 whitespace-nowrap">{uploading ? "Загрузка…" : "+ Загрузить"}</button>
            </>
          )}
        </div>
      </div>

      {error && <div className="px-4 py-2 text-sm text-red-400 bg-red-500/10">{error}</div>}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-[var(--text-muted,#9aa0ab)]">Загрузка…</div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-muted,#9aa0ab)]">
          <div className="mb-3"><FolderIcon size={48} /></div>
          <p>{query ? "Ничего не найдено" : "Файлов пока нет"}</p>
          {canEdit && !query && <button onClick={onPick} className="mt-3 px-4 py-2 rounded-lg bg-[var(--accent,#3b82f6)] text-white">Загрузить первый файл</button>}
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-3 space-y-1.5">
          {filtered.map((f) => {
            const ext = extOf(f.name);
            return (
              <div key={f.id} className="flex items-center gap-3 p-2.5 max-md:min-h-[60px] rounded-lg bg-[var(--bg-secondary,#1a1d27)] md:hover:bg-[var(--bg-tertiary,#222633)] group">
                <span className="shrink-0">{iconFor(ext, 24)}</span>
                <button onClick={() => setPreview(f)} className="flex-1 min-w-0 text-left">
                  <div className="font-medium truncate">{f.name}</div>
                  <div className="text-xs text-[var(--text-muted,#9aa0ab)]">{fmtSize(f.size)} · {f.uploader.name} · {new Date(f.createdAt).toLocaleDateString("ru-RU")}</div>
                </button>
                {/* MOBILE-FIX: на таче hover не существует — действия видны всегда
                    (на десктопе прежнее поведение: появляются при наведении). */}
                <div className="flex gap-1 shrink-0 md:opacity-0 md:group-hover:opacity-100">
                  <button onClick={() => downloadFile(f)} className="min-w-[40px] min-h-[40px] md:min-w-0 md:min-h-0 inline-flex items-center justify-center px-2 py-1 text-xs rounded active:bg-[var(--bg-primary,#0f1117)] md:hover:bg-[var(--bg-primary,#0f1117)]" title="Скачать" aria-label="Скачать"><DownloadIcon size={16} /></button>
                  {(canEdit || f.uploader.id === currentUserId) && (
                    <button onClick={() => onDelete(f)} className="min-w-[40px] min-h-[40px] md:min-w-0 md:min-h-0 inline-flex items-center justify-center px-2 py-1 text-xs rounded active:bg-[var(--bg-primary,#0f1117)] md:hover:bg-[var(--bg-primary,#0f1117)]" title="Удалить" aria-label="Удалить"><TrashIcon size={16} /></button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {preview && <FileViewer file={preview} onClose={() => setPreview(null)} onDownload={() => downloadFile(preview)} />}
    </div>
  );
}

function FileViewer({ file, onClose, onDownload }: { file: WFile; onClose: () => void; onDownload: () => void }) {
  const ext = extOf(file.name);
  let content: React.ReactNode;
  if (OFFICE_EXT.includes(ext)) {
    /* FIX-DOCS: раньше здесь был просмотрщик Microsoft
       (view.officeapps.live.com). Он загружает файл ПО ССЫЛКЕ со своей стороны,
       а сервер сообщества закрыт от интернета и требует сессию — сервису
       нечего было показать, и пользователь видел белый экран. Показываем
       честное объяснение и открываем файл в системном приложении. */
    content = (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 px-6 text-center text-[var(--text-muted,#9aa0ab)]">
        <div>{iconFor(ext, 56)}</div>
        <p className="max-w-sm text-sm">
          Документы Word, Excel и PowerPoint открываются в приложении на вашем устройстве —
          встроенный просмотрщик для них недоступен.
        </p>
        <button
          onClick={() => onDownload()}
          className="px-4 py-2 rounded-lg bg-[var(--accent,#3b82f6)] text-white text-sm"
        >
          Открыть файл
        </button>
      </div>
    );
  } else if (INLINE_EXT.includes(ext)) {
    /* PDF и текстовые форматы браузер показывает сам — теперь, когда сервер
       отдаёт им правильный Content-Type (см. MIME_TYPES в server.ts). */
    content = <iframe src={file.url} className="w-full h-full border-0 bg-white" title={file.name} />;
  } else if (IMG_EXT.includes(ext)) {
    content = <div className="w-full h-full flex items-center justify-center bg-black/40"><img src={file.url} alt={file.name} className="max-w-full max-h-full object-contain" /></div>;
  } else {
    content = (
      <div className="w-full h-full flex flex-col items-center justify-center text-[var(--text-muted,#9aa0ab)]">
        <div className="mb-4">{iconFor(ext, 56)}</div>
        <p className="mb-3">Предпросмотр недоступен для этого формата</p>
        <button onClick={() => onDownload()} className="px-4 py-2 rounded-lg bg-[var(--accent,#3b82f6)] text-white">Скачать файл</button>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/70" onClick={onClose}>
      <div className="flex items-center justify-between px-4 py-3 bg-[var(--bg-secondary,#1a1d27)] text-[var(--text-primary,#e6e6e6)]" onClick={(e) => e.stopPropagation()}>
        <span className="font-medium truncate">{file.name}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => onDownload()} className="px-3 py-1.5 text-sm rounded-lg bg-[var(--accent,#3b82f6)] text-white">Скачать</button>
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg hover:bg-[var(--bg-primary,#0f1117)] inline-flex items-center gap-1.5">Закрыть <XIcon size={13} style={{ color: "inherit" }} /></button>
        </div>
      </div>
      <div className="flex-1 m-4 rounded-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>{content}</div>
    </div>
  );
}
