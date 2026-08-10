"use client";

import { useRef, useState } from "react";
import Spinner from "@/components/ui/Spinner";

interface ImageInputProps {
  value: string;
  onChange: (url: string) => void;
  uploadDir?: "ecosystem" | "windows" | "articles";
  placeholder?: string;
  label?: string;
  maxSizeLabel?: string;
}

export default function ImageInput({
  value,
  onChange,
  uploadDir = "ecosystem",
  placeholder = "https://... или загрузите файл",
  label,
  maxSizeLabel = "5 МБ",
}: ImageInputProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(value || null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
      setError("Только PNG, JPG, WebP или GIF");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError(`Файл слишком большой (макс. ${maxSizeLabel})`);
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("dir", uploadDir);

    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    const data = await res.json();
    setUploading(false);

    if (!res.ok) {
      setError(data.error ?? "Ошибка загрузки");
      setPreview(value || null);
      return;
    }

    setPreview(data.url);
    onChange(data.url);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    onChange(v);
    setPreview(v || null);
    setError(null);
  };

  const clearImage = () => {
    onChange("");
    setPreview(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="space-y-2">
      {label && <label className="block text-sm text-gray-400">{label}</label>}

      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={handleUrlChange}
          placeholder={placeholder}
          className="input-field flex-1 min-w-0"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Загрузить с устройства"
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg
            bg-cyan-400/10 text-cyan-400 border border-cyan-400/20
            hover:bg-cyan-400/20 disabled:opacity-50 disabled:cursor-not-allowed
            transition-all text-sm font-medium whitespace-nowrap"
        >
          {uploading ? (
            <>
              <Spinner size="sm" tone="current" />
              Загрузка...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Загрузить
            </>
          )}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleFile}
      />

      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </p>
      )}

      {preview && (
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="preview"
            className="h-24 rounded-lg object-cover border border-white/10"
          />
          <button
            type="button"
            onClick={clearImage}
            title="Удалить изображение"
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white
              flex items-center justify-center hover:bg-red-600 transition-colors shadow"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <p className="text-[10px] text-gray-500 mt-1 max-w-[12rem] truncate">{value}</p>
        </div>
      )}

      {!preview && (
        <p className="text-[11px] text-gray-600">PNG, JPG, WebP, GIF · макс. {maxSizeLabel}</p>
      )}
    </div>
  );
}
