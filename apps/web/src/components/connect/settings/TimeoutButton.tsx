"use client";

// NEW: кнопка тайм-аута для строки участника в разделе «Участники».
// Промежуточная мера между киком и баном: временный запрет отправки сообщений.
// API: POST/DELETE /api/groups/{groupId}/members/{memberId}/timeout

import { useState } from "react";

const DURATIONS = [
  { label: "5 минут", minutes: 5 },
  { label: "30 минут", minutes: 30 },
  { label: "1 час", minutes: 60 },
  { label: "8 часов", minutes: 480 },
  { label: "1 день", minutes: 1440 },
  { label: "7 дней", minutes: 10080 },
];

export default function TimeoutButton({
  groupId,
  memberId,
  mutedUntil,
  onChanged,
}: {
  groupId: string;
  memberId: string;
  /** GroupMember.mutedUntil из данных группы (ISO-строка или null) */
  mutedUntil?: string | null;
  /** Колбэк для перезагрузки данных группы после изменения */
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const isActive = !!mutedUntil && new Date(mutedUntil) > new Date();

  const apply = async (minutes: number) => {
    setBusy(true);
    try {
      await fetch(`/api/groups/${groupId}/members/${memberId}/timeout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes, reason: reason.trim() || undefined }),
      });
      setOpen(false);
      setReason("");
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await fetch(`/api/groups/${groupId}/members/${memberId}/timeout`, { method: "DELETE" });
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  if (isActive) {
    return (
      <button
        onClick={clear}
        disabled={busy}
        title={`Тайм-аут до ${new Date(mutedUntil as string).toLocaleString("ru-RU")}`}
        className="rounded-lg bg-green-500/15 hover:bg-green-500/25 text-green-400 px-2.5 py-1 text-xs disabled:opacity-50"
      >
        Снять тайм-аут
      </button>
    );
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 px-2.5 py-1 text-xs"
      >
        Тайм-аут
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-56 rounded-xl border border-white/10 bg-zinc-900 p-2 shadow-xl space-y-1">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            placeholder="Причина (необязательно)"
            className="w-full rounded-lg bg-black/30 border border-white/10 px-2 py-1.5 text-xs"
          />
          {DURATIONS.map((d) => (
            <button
              key={d.minutes}
              onClick={() => apply(d.minutes)}
              disabled={busy}
              className="block w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-white/10 disabled:opacity-50"
            >
              {d.label}
            </button>
          ))}
          <button
            onClick={() => setOpen(false)}
            className="block w-full rounded-lg px-2 py-1.5 text-left text-xs opacity-60 hover:bg-white/10"
          >
            Отмена
          </button>
        </div>
      )}
    </div>
  );
}
