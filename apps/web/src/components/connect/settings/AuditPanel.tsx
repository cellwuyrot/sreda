"use client";

// NEW: вкладка «Аудит» для GroupSettingsModal.
// Показывает журнал модераторских действий (GET /api/groups/{id}/audit).

import { useCallback, useEffect, useState } from "react";

interface AuditEntry {
  id: string;
  actorName: string;
  action: string;
  targetName: string | null;
  details: string | null;
  createdAt: string;
}

const ACTION_LABELS: Record<string, string> = {
  "settings.update": "Изменение настроек",
  "member.role": "Смена роли",
  "member.kick": "Исключение",
  "member.timeout": "Тайм-аут",
  "member.untimeout": "Снятие тайм-аута",
  "ban.add": "Бан",
  "ban.remove": "Разбан",
  "invite.create": "Создание приглашения",
  "invite.revoke": "Отзыв приглашения",
  // MODERATION: удаление чужих сообщений и разбор жалоб.
  "message.delete": "Удаление сообщения",
  "message.purge": "Чистка сообщений",
  "report.resolve": "Жалоба: меры приняты",
  "report.dismiss": "Жалоба отклонена",
};

const ACTION_COLORS: Record<string, string> = {
  "member.kick": "text-orange-400 bg-orange-500/15",
  "member.timeout": "text-orange-400 bg-orange-500/15",
  "ban.add": "text-red-400 bg-red-500/15",
  "ban.remove": "text-green-400 bg-green-500/15",
  "member.untimeout": "text-green-400 bg-green-500/15",
  "invite.revoke": "text-orange-400 bg-orange-500/15",
  "message.delete": "text-orange-400 bg-orange-500/15",
  "message.purge": "text-red-400 bg-red-500/15",
  "report.resolve": "text-green-400 bg-green-500/15",
  "report.dismiss": "text-neutral-400 bg-neutral-500/15",
};

export default function AuditPanel({ groupId }: { groupId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (before?: string) => {
      const qs = before ? `?before=${encodeURIComponent(before)}` : "";
      const res = await fetch(`/api/groups/${groupId}/audit${qs}`);
      if (res.ok) {
        const data = await res.json();
        setEntries((prev) => (before ? [...prev, ...data.entries] : data.entries));
        setHasMore(!!data.hasMore);
      }
      setLoading(false);
    },
    [groupId],
  );

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="text-sm opacity-60">Загрузка…</div>;

  if (entries.length === 0) {
    return <div className="text-sm opacity-60">Журнал пока пуст. Здесь будут отображаться действия модераторов.</div>;
  }

  return (
    <div className="space-y-2">
      {entries.map((e) => (
        <div key={e.id} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${ACTION_COLORS[e.action] ?? "text-blue-400 bg-blue-500/15"}`}
            >
              {ACTION_LABELS[e.action] ?? e.action}
            </span>
            <span className="text-sm font-medium">{e.actorName}</span>
            {e.targetName && (
              <span className="text-sm opacity-70">→ {e.targetName}</span>
            )}
            <span className="ml-auto text-xs opacity-50">
              {new Date(e.createdAt).toLocaleString("ru-RU", {
                day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
              })}
            </span>
          </div>
          {e.details && <div className="mt-1 text-xs opacity-60">{e.details}</div>}
        </div>
      ))}
      {hasMore && (
        <button
          onClick={() => load(entries[entries.length - 1]?.createdAt)}
          className="w-full rounded-lg bg-white/10 hover:bg-white/20 px-3 py-2 text-sm"
        >
          Показать ещё
        </button>
      )}
    </div>
  );
}
