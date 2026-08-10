"use client";

// NEW: загрузка баннера сообщества (вкладка «Обзор»).
// Баннер хранится как data URL в Group.banner — по той же схеме,
// что и User.profileBanner. Картинка ужимается на клиенте до 1600px ширины (JPEG).
// Сохранение: PUT /api/groups/{id} { banner }

import { useRef, useState } from "react";

const MAX_WIDTH = 1600;
const MAX_DATAURL_LENGTH = 900_000;

async function fileToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  // Подбираем качество, чтобы уложиться в лимит размера
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= MAX_DATAURL_LENGTH) return url;
  }
  throw new Error("Изображение слишком большое — выберите файл поменьше");
}

export default function BannerUpload({
  groupId,
  banner,
  onChanged,
}: {
  groupId: string;
  banner?: string | null;
  onChanged?: (banner: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(banner ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (value: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ banner: value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Не удалось сохранить баннер");
      }
      setPreview(value);
      onChanged?.(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const url = await fileToDataUrl(file);
      await save(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обработать изображение");
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Баннер сообщества</div>
      <div
        className="relative h-28 w-full overflow-hidden rounded-xl border border-white/10 bg-white/5"
        style={preview ? { backgroundImage: `url(${preview})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
      >
        {!preview && (
          <div className="flex h-full items-center justify-center text-xs opacity-50">
            Баннер не установлен
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs disabled:opacity-50"
        >
          {busy ? "Сохранение…" : "Загрузить"}
        </button>
        {preview && (
          <button
            onClick={() => save(null)}
            disabled={busy}
            className="rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-400 px-3 py-1.5 text-xs disabled:opacity-50"
          >
            Убрать
          </button>
        )}
      </div>
      {error && <div className="text-xs text-red-400">{error}</div>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
    </div>
  );
}
