"use client";

/**
 * FIX-BGCROP: выбор фона профиля с рамкой.
 *
 * Файл уезжает на сервер как есть — без canvas, без перекодирования, без data
 * URL. Это главное требование: любая пересборка анимированного GIF стирает все
 * кадры, кроме первого, и именно так исчезала анимация.
 *
 * Обрезать тоже нельзя — поэтому вместо обрезки человек выбирает рамку: что
 * показано в предпросмотре, то и увидят другие. Выбор едет в адресе картинки
 * параметрами fx/fy/z (см. lib/bannerFraming.ts).
 *
 * Положение задаётся ползунками, а не перетаскиванием: ползунки одинаково
 * работают мышью, пальцем и с клавиатуры, и не воюют с прокруткой страницы на
 * телефоне — а именно через телефон гифки и грузят чаще всего.
 */

import { useEffect, useRef, useState } from "react";
import {
  BANNER_ACCEPT,
  BANNER_MAX_BYTES,
  bannerImgStyle,
  buildBanner,
  parseBanner,
} from "@/lib/bannerFraming";

export default function BackgroundPicker({
  value,
  onChange,
  onError,
  aspect = 3,
  label = "Фон профиля",
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  onError?: (message: string | null) => void;
  /** Отношение сторон рамки: 3 — широкая шапка, 4.5 — полоска мини-профиля. */
  aspect?: number;
  label?: string;
}) {
  const framing = parseBanner(value);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fx, setFx] = useState(framing?.fx ?? 50);
  const [fy, setFy] = useState(framing?.fy ?? 50);
  const [zoom, setZoom] = useState(framing?.zoom ?? 1);
  const inputRef = useRef<HTMLInputElement>(null);

  /* Значение может приехать снаружи (загрузка профиля, смена сообщества) —
     ползунки должны показывать то, что в адресе, а не прошлый выбор. */
  const base = framing?.base ?? null;
  useEffect(() => {
    const next = parseBanner(value);
    setFx(next?.fx ?? 50);
    setFy(next?.fy ?? 50);
    setZoom(next?.zoom ?? 1);
  }, [base, value]);

  function fail(message: string) {
    setError(message);
    onError?.(message);
  }

  function apply(nextFx: number, nextFy: number, nextZoom: number) {
    setFx(nextFx);
    setFy(nextFy);
    setZoom(nextZoom);
    if (framing) onChange(buildBanner(framing.base, nextFx, nextFy, nextZoom));
  }

  async function upload(file: File) {
    if (file.size > BANNER_MAX_BYTES) {
      fail(`Файл больше 10 МБ (${(file.size / 1024 / 1024).toFixed(1)} МБ) — выберите поменьше`);
      return;
    }
    setUploading(true);
    setError(null);
    onError?.(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("type", "banner");
      const res = await fetch("/api/profile/avatar", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !data?.url) {
        fail(data?.error ?? "Не удалось загрузить файл");
        return;
      }
      /* Новая картинка — рамка с нуля: прежние fx/fy относились к другой картинке. */
      setFx(50);
      setFy(50);
      setZoom(1);
      onChange(data.url);
    } catch {
      fail("Ошибка сети при загрузке");
    } finally {
      setUploading(false);
    }
  }

  const isAnimated = !!framing && /\.gif(\?|$)/i.test(framing.base);

  return (
    <div className="space-y-2">
      <div
        className="relative w-full overflow-hidden rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-100 dark:bg-white/5"
        style={{ aspectRatio: `${aspect} / 1` }}
      >
        {framing ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={framing.src}
            alt=""
            className="absolute inset-0 h-full w-full"
            style={bannerImgStyle(buildBanner(framing.base, fx, fy, zoom))}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-neutral-400">
            {label} не загружен
          </div>
        )}
        {framing && (
          <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/40 dark:ring-white/20" />
        )}
      </div>

      {framing && (
        <div className="space-y-1.5 rounded-xl border border-neutral-200 dark:border-white/10 p-3">
          <p className="text-[11px] leading-4 text-neutral-500 dark:text-neutral-400">
            Внутри рамки выше — ровно то, что увидят другие. Файл не обрезается и не
            пережимается{isAnimated ? " — анимация GIF остаётся целиком" : ""}.
          </p>
          <label className="flex items-center gap-2 text-[11px] text-neutral-600 dark:text-neutral-300">
            <span className="w-24 flex-shrink-0">По горизонтали</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={fx}
              onChange={(e) => apply(Number(e.target.value), fy, zoom)}
              className="flex-1"
            />
            <span className="w-10 text-right tabular-nums">{fx}%</span>
          </label>
          <label className="flex items-center gap-2 text-[11px] text-neutral-600 dark:text-neutral-300">
            <span className="w-24 flex-shrink-0">По вертикали</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={fy}
              onChange={(e) => apply(fx, Number(e.target.value), zoom)}
              className="flex-1"
            />
            <span className="w-10 text-right tabular-nums">{fy}%</span>
          </label>
          <label className="flex items-center gap-2 text-[11px] text-neutral-600 dark:text-neutral-300">
            <span className="w-24 flex-shrink-0">Масштаб</span>
            <input
              type="range"
              min={1}
              max={4}
              step={0.05}
              value={zoom}
              onChange={(e) => apply(fx, fy, Number(e.target.value))}
              className="flex-1"
            />
            <span className="w-10 text-right tabular-nums">{zoom.toFixed(2)}×</span>
          </label>
          <button
            type="button"
            onClick={() => apply(50, 50, 1)}
            className="text-[11px] text-neutral-400 hover:text-violet-600 dark:hover:text-cyan-400 transition-colors"
          >
            Сбросить рамку
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="px-3 py-2 bg-violet-500/10 text-violet-600 dark:text-violet-400 rounded-xl text-xs font-medium hover:bg-violet-500/20 transition-colors disabled:opacity-50"
        >
          {uploading ? "Загрузка…" : framing ? "Заменить фон" : "Загрузить фон"}
        </button>
        {framing && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              onError?.(null);
              onChange(null);
            }}
            className="text-xs text-neutral-400 hover:text-red-500 transition-colors"
          >
            Убрать
          </button>
        )}
        <span className="text-[11px] text-neutral-400">PNG, JPEG, WebP или GIF, до 10 МБ</span>
      </div>

      {error && <p className="text-[11px] text-red-500">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept={BANNER_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
    </div>
  );
}
