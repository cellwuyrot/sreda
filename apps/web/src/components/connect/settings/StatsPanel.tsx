"use client";

// NEW: блок статистики активности для вкладки «Обзор» GroupSettingsModal.
// Данные: GET /api/groups/{id}/stats

import { useEffect, useState } from "react";

interface Stats {
  membersTotal: number;
  joins7d: number;
  joins30d: number;
  messages7d: number;
  messages30d: number;
  activeMembers7d: number;
  bansTotal: number;
  invitesActive: number;
  topChannels30d: { channelId: string; name: string; messages: number }[];
}

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-xs opacity-60">{label}</div>
      {hint && <div className="text-[10px] opacity-40">{hint}</div>}
    </div>
  );
}

export default function StatsPanel({ groupId }: { groupId: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch(`/api/groups/${groupId}/stats`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setStats)
      .catch(() => setFailed(true));
  }, [groupId]);

  if (failed) return null;
  if (!stats) return <div className="text-sm opacity-60">Загрузка статистики…</div>;

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">Активность</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard label="Сообщений за 7 дней" value={stats.messages7d} />
        <StatCard label="Сообщений за 30 дней" value={stats.messages30d} />
        <StatCard label="Активны за 7 дней" value={stats.activeMembers7d} hint="писали сообщения" />
        <StatCard label="Новых за 30 дней" value={`+${stats.joins30d}`} hint={`за 7 дней: +${stats.joins7d}`} />
      </div>
      {stats.topChannels30d.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <div className="text-xs opacity-60 mb-2">Самые активные каналы (30 дней)</div>
          <div className="space-y-1">
            {stats.topChannels30d.map((c) => (
              <div key={c.channelId} className="flex items-center justify-between text-sm">
                <span># {c.name}</span>
                <span className="opacity-60 text-xs">{c.messages} сообщ.</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
