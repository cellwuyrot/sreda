"use client";

/**
 * Свои эмодзи сообщества (раздел «Эмодзи» в настройках).
 *
 * FIX-NOSHARP: квадрат 128×128 делает БРАУЗЕР перед отправкой — на сервере
 * обработки картинок больше нет (нативная библиотека несовместима с процессором
 * машины). Правило одно для всех клиентов, поэтому набор остаётся ровным, а
 * сервер проверяет сигнатуру и сторону.
 *
 * Предел набора зависит от подписки ВЛАДЕЛЬЦА сообщества — это неочевидно,
 * поэтому число приходит с сервера вместе со списком (одним запросом) и
 * поясняется подсказкой «?», а не длинной строкой в интерфейсе.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import InfoTooltip from "@/components/ui/InfoTooltip";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { downscaleForEmoji } from "@/lib/clientImageResize"; // FIX-NOSHARP

interface GroupEmoji {
  id: string;
  name: string;
  url: string;
}

/** Имя из названия файла: «Смешной Кот.png» → «кот» не выйдет, а «cat_2.png» —
 *  вполне. Это только подсказка: поле остаётся редактируемым. */
function nameFromFile(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

export default function EmojiPanel({ groupId, canManage }: { groupId: string; canManage: boolean }) {
  const [emojis, setEmojis] = useState<GroupEmoji[] | null>(null);
  const [limit, setLimit] = useState(0);
  const [ownerPremium, setOwnerPremium] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/groups/${groupId}/emoji`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setEmojis([]);
        setError(data?.error || "Не удалось загрузить набор эмодзи");
        return;
      }
      const data = await res.json();
      setEmojis(data.emojis ?? []);
      setLimit(data.limit ?? 0);
      setOwnerPremium(!!data.ownerPremium);
    } catch {
      setEmojis([]);
      setError("Ошибка сети");
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pickFile = (picked: File | undefined) => {
    if (!picked) return;
    setError("");
    setFile(picked);
    // Имя подставляем только в пустое поле, чтобы не затирать набранное руками.
    setName((prev) => prev || nameFromFile(picked.name));
  };

  const upload = async () => {
    if (!file) {
      setError("Сначала выберите картинку");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", await downscaleForEmoji(file)); // FIX-NOSHARP
      body.append("name", name.trim().toLowerCase());
      const res = await fetch(`/api/groups/${groupId}/emoji`, { method: "POST", body });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Не удалось добавить эмодзи");
        return;
      }
      setEmojis((prev) => [...(prev ?? []), data.emoji]);
      setFile(null);
      setName("");
      if (inputRef.current) inputRef.current.value = "";
    } catch {
      setError("Ошибка сети");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (emoji: GroupEmoji) => {
    if (!(await confirmDialog({ message: `Удалить эмодзи «:${emoji.name}:»? В старых сообщениях останется текст «:${emoji.name}:».`, confirmText: "Удалить", danger: true }))) return;
    setError("");
    const res = await fetch(`/api/groups/${groupId}/emoji/${emoji.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error || "Не удалось удалить эмодзи");
      return;
    }
    setEmojis((prev) => (prev ?? []).filter((e) => e.id !== emoji.id));
  };

  const total = emojis?.length ?? 0;
  /* Пока предел не пришёл с сервера, он равен нулю — считать набор заполненным
     в этот момент нельзя, иначе при открытии раздела мигало бы «набор полон». */
  const full = limit > 0 && total >= limit;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">
          {emojis === null ? "…" : `${total} из ${limit}`}
        </span>
        <span className="text-xs opacity-60">
          {ownerPremium ? "предел сообщества с Premium у владельца" : "предел сообщества без Premium у владельца"}
        </span>
        <InfoTooltip text="Сколько своих эмодзи помещается в сообществе, зависит от подписки его создателя, а не от вашей: набор принадлежит сообществу. Если создатель оформит Premium, предел вырастет, а уже добавленные эмодзи останутся на месте." />
      </div>

      {canManage && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
          <div className="text-sm font-medium">Новый эмодзи</div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              pickFile(e.dataTransfer.files?.[0]);
            }}
            className={`w-full rounded-xl border border-dashed px-4 py-6 text-xs transition-colors ${
              dragOver ? "border-violet-400 bg-violet-500/10 dark:border-cyan-400 dark:bg-cyan-400/10" : "border-white/15 bg-black/10 hover:bg-white/5"
            }`}
          >
            {file ? (
              <span className="font-medium">{file.name}</span>
            ) : (
              <>
                <span className="block">Перетащите картинку сюда или нажмите, чтобы выбрать</span>
                <span className="block mt-1 opacity-60">PNG, JPG, WebP или GIF, до 5 МБ. Сервер сам сделает квадрат 128×128; у GIF берётся первый кадр.</span>
              </>
            )}
          </button>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs opacity-70 flex flex-col gap-1">
              Имя
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="cat_vibe"
                maxLength={32}
                className="rounded-lg bg-black/30 border border-white/10 px-2 py-1.5 text-sm text-inherit"
              />
            </label>
            <span className="text-xs opacity-60 pb-2">
              В сообщении будет «:{name.trim().toLowerCase() || "имя"}:»
            </span>
            <button
              type="button"
              onClick={upload}
              disabled={busy || !file || full}
              className="ml-auto rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {busy ? "Загрузка…" : "Добавить"}
            </button>
          </div>
          {full && <div className="text-xs opacity-60">Набор заполнен — освободите место, удалив ненужный эмодзи.</div>}
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </div>
      )}

      {error && <div className="text-xs text-red-400">{error}</div>}

      {emojis === null ? (
        <div className="text-sm opacity-60">Загрузка…</div>
      ) : emojis.length === 0 ? (
        <div className="text-sm opacity-60">Своих эмодзи пока нет.</div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {emojis.map((emoji) => (
            <div key={emoji.id} className="flex flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2 py-3">
              {/* Оптимизация картинок в проекте отключена — обычный <img>, как у аватаров. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={emoji.url} alt={`:${emoji.name}:`} width={40} height={40} loading="lazy" decoding="async" className="w-10 h-10 object-contain" />
              <code className="text-[11px] font-mono opacity-80 truncate max-w-full">:{emoji.name}:</code>
              {canManage && (
                <button
                  type="button"
                  onClick={() => remove(emoji)}
                  className="rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-400 px-2.5 py-1 text-xs"
                >
                  Удалить
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
