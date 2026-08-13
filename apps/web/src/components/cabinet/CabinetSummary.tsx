"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/components/cabinet/ProjectBusinessPanel";

/**
 * BUSINESS-CABINET: сводка по проектам для личного кабинета партнёра.
 *
 * Данные берутся из /api/projects/summary, где отбор делается НА СЕРВЕРЕ по
 * владельцу: через параметры запроса чужую сводку получить нельзя.
 */

type Row = {
  id: string;
  name: string;
  status: string;
  dueDate: string | null;
  responsible: { name: string | null; username: string | null } | null;
  documents: number;
  money: { billed: number; paid: number; unpaid: number };
};

type Summary = {
  projects: Row[];
  totals: { billed: number; paid: number; unpaid: number };
  counts: { total: number; active: number; overdue: number };
};

const STATUS_LABEL: Record<string, string> = {
  NEW: "Новый",
  IN_PROGRESS: "В работе",
  LAUNCHED: "Запущен",
};

export default function CabinetSummary() {
  const [data, setData] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/projects/summary", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => { if (alive) { if (json) setData(json); else setFailed(true); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  if (failed || !data) return null;

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-white/10 dark:bg-neutral-900">
      <div className="mb-3">
        <h2 className="font-semibold text-neutral-900 dark:text-white">Сводка по проектам</h2>
        <p className="text-xs text-neutral-500 dark:text-gray-400">Сроки, ответственные и деньги — без поиска по переписке</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Выставлено", formatMoney(data.totals.billed)],
          ["Оплачено", formatMoney(data.totals.paid)],
          ["К оплате", formatMoney(data.totals.unpaid)],
          ["Просрочено сроков", String(data.counts.overdue)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-neutral-200 px-3 py-2 dark:border-white/10">
            <p className="text-sm font-semibold text-neutral-900 dark:text-white">{value}</p>
            <p className="text-[11px] text-neutral-500 dark:text-gray-400">{label}</p>
          </div>
        ))}
      </div>

      {data.projects.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-neutral-400">
                <th className="py-1.5 pr-3 font-medium">Проект</th>
                <th className="py-1.5 pr-3 font-medium">Статус</th>
                <th className="py-1.5 pr-3 font-medium">Срок</th>
                <th className="py-1.5 pr-3 font-medium">Ответственный</th>
                <th className="py-1.5 font-medium">К оплате</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-white/10">
              {data.projects.map((row) => (
                <tr key={row.id}>
                  <td className="py-2 pr-3 text-neutral-800 dark:text-neutral-100">{row.name}</td>
                  <td className="py-2 pr-3 text-neutral-500 dark:text-gray-400">{STATUS_LABEL[row.status] || row.status}</td>
                  <td className="py-2 pr-3 text-neutral-500 dark:text-gray-400">
                    {row.dueDate ? new Date(row.dueDate).toLocaleDateString("ru-RU") : "—"}
                  </td>
                  <td className="py-2 pr-3 text-neutral-500 dark:text-gray-400">{row.responsible?.name || row.responsible?.username || "—"}</td>
                  <td className="py-2 text-neutral-800 dark:text-neutral-100">{formatMoney(row.money.unpaid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
