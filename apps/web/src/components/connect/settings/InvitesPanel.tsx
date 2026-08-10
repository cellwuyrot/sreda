"use client";

// NEW: полноценное управление приглашениями для GroupSettingsModal.
// Заменяет содержимое раздела «Приглашения»: выбор срока действия,
// лимита использований и отзыв ссылок (DELETE /api/invites/{code}).
// Стили — нейтральный тёмный Tailwind; при необходимости подгоните классы под модал.

import { useCallback, useEffect, useState } from "react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";

interface InviteRow {
  code: string;
  uses: number;
  maxUses: number;
  expiresAt: string | null;
}

const EXPIRY_OPTIONS = [
  { value: 1, label: "1 час" },
  { value: 12, label: "12 часов" },
  { value: 24, label: "24 часа" },
  { value: 168, label: "7 дней" },
  { value: 720, label: "30 дней" },
  { value: 0, label: "Бессрочно" },
];

const MAX_USES_OPTIONS = [
  { value: 0, label: "Без лимита" },
  { value: 1, label: "1 использование" },
  { value: 5, label: "5" },
  { value: 10, label: "10" },
  { value: 25, label: "25" },
  { value: 50, label: "50" },
  { value: 100, label: "100" },
];

function inviteStatus(inv: InviteRow): { label: string; active: boolean } {
  if (inv.expiresAt && new Date(inv.expiresAt) < new Date()) {
    return { label: "Истекло", active: false };
  }
  if (inv.maxUses > 0 && inv.uses >= inv.maxUses) {
    return { label: "Лимит исчерпан", active: false };
  }
  return { label: "Активно", active: true };
}

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return "бессрочно";
  return new Date(expiresAt).toLocaleString("ru-RU", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default function InvitesPanel({ groupId }: { groupId: string }) {
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expires, setExpires] = useState(24);
  const [maxUses, setMaxUses] = useState(0);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/groups/${groupId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setInvites(data.invites ?? []);
    } catch {
      setError("Не удалось загрузить приглашения");
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, expiresInHours: expires, maxUses }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Ошибка создания");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка создания");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (code: string) => {
    if (!(await confirmDialog({ message: "Отозвать приглашение? Ссылка перестанет работать.", confirmText: "Отозвать", danger: true }))) return;
    const res = await fetch(`/api/invites/${code}`, { method: "DELETE" });
    if (res.ok) {
      setInvites((prev) => prev.filter((i) => i.code !== code));
    }
  };

  const copy = (code: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/invite/${code}`);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="space-y-4">
      {/* Форма создания */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="text-sm font-medium">Новое приглашение</div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs opacity-70 flex flex-col gap-1">
            Срок действия
            <select
              value={expires}
              onChange={(e) => setExpires(Number(e.target.value))}
              className="rounded-lg bg-black/30 border border-white/10 px-2 py-1.5 text-sm text-inherit"
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs opacity-70 flex flex-col gap-1">
            Макс. использований
            <select
              value={maxUses}
              onChange={(e) => setMaxUses(Number(e.target.value))}
              className="rounded-lg bg-black/30 border border-white/10 px-2 py-1.5 text-sm text-inherit"
            >
              {MAX_USES_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <button
            onClick={create}
            disabled={creating}
            className="rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {creating ? "Создание…" : "Создать ссылку"}
          </button>
        </div>
        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>

      {/* Список */}
      {loading ? (
        <div className="text-sm opacity-60">Загрузка…</div>
      ) : invites.length === 0 ? (
        <div className="text-sm opacity-60">Приглашений пока нет</div>
      ) : (
        <div className="space-y-2">
          {invites.map((inv) => {
            const status = inviteStatus(inv);
            return (
              <div
                key={inv.code}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3"
              >
                <code className="text-sm font-mono">{inv.code}</code>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    status.active ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
                  }`}
                >
                  {status.label}
                </span>
                <span className="text-xs opacity-60">
                  {inv.uses}{inv.maxUses > 0 ? ` / ${inv.maxUses}` : ""} исп. · до: {formatExpiry(inv.expiresAt)}
                </span>
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={() => copy(inv.code)}
                    className="rounded-lg bg-white/10 hover:bg-white/20 px-2.5 py-1 text-xs"
                  >
                    {copied === inv.code ? "Скопировано" : "Копировать"}
                  </button>
                  <button
                    onClick={() => revoke(inv.code)}
                    className="rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-400 px-2.5 py-1 text-xs"
                  >
                    Отозвать
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
