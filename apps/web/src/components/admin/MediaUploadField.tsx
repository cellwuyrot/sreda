"use client";

/**
 * Загрузка медиафайла для блоков страницы /about.
 *
 * Раньше в редакторах стояли текстовые поля «URL картинки» / «URL видео»:
 * админу приходилось где-то отдельно размещать файл и вставлять ссылку.
 * Здесь файл выбирается с компьютера, уходит в /api/about-media и сохраняется
 * в /uploads/about/, а в данные блока попадает уже готовый локальный путь.
 */

import { useRef, useState } from "react";

export type MediaUploadFieldProps = {
  /** Текущий путь к файлу, например /uploads/about/abc.png. */
  value?: string;
  onChange: (url: string) => void;
  /** Что разрешено выбирать. */
  kind?: "image" | "video" | "both";
  /** Подпись кнопки, когда файла ещё нет. */
  label?: string;
  /** Высота превью в пикселях. */
  previewHeight?: number;
};

const ACCEPT: Record<NonNullable<MediaUploadFieldProps["kind"]>, string> = {
  image: "image/png,image/jpeg,image/webp,image/gif",
  video: "video/mp4,video/webm,video/quicktime",
  both: "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime",
};

const VIDEO_EXT = [".mp4", ".webm", ".mov"];

/** Видео и картинку нужно показывать разными тегами, отличаем по расширению. */
export function isVideoUrl(url?: string): boolean {
  const value = (url ?? "").toLowerCase().split("?")[0];
  return VIDEO_EXT.some((ext) => value.endsWith(ext));
}

export default function MediaUploadField({
  value,
  onChange,
  kind = "image",
  label = "Загрузить файл",
  previewHeight = 120,
}: MediaUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/about-media", { method: "POST", body });
      const json = (await res.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;

      if (!res.ok || !json?.url) {
        // Понятная причина отказа важнее: 413 и 415 без текста выглядели
        // как «загрузка просто не работает».
        setError(json?.error ?? "Не удалось загрузить файл");
        return;
      }
      onChange(json.url);
    } catch {
      setError("Сеть недоступна — файл не загружен");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const showVideo = isVideoUrl(value);

  return (
    <div className="space-y-2" data-testid="media-upload">
      {value ? (
        <div
          className="overflow-hidden rounded-xl border border-white/10 bg-black/30"
          style={{ height: previewHeight }}
        >
          {showVideo ? (
            <video src={value} className="h-full w-full object-cover" muted playsInline />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="h-full w-full object-cover" />
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-300 transition-colors hover:bg-indigo-500/20 disabled:opacity-50"
        >
          {busy ? "Загрузка…" : value ? "Заменить файл" : label}
        </button>

        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-neutral-400 transition-colors hover:border-red-500/40 hover:text-red-300"
          >
            Убрать
          </button>
        ) : null}

        {value ? (
          <span className="truncate text-[11px] text-neutral-600">{value}</span>
        ) : (
          <span className="text-[11px] text-neutral-600">
            {kind === "video"
              ? "MP4, WebM, MOV — до 200 МБ"
              : kind === "image"
                ? "PNG, JPG, WebP, GIF — до 200 МБ"
                : "Картинка или видео — до 200 МБ"}
          </span>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT[kind]}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
    </div>
  );
}
