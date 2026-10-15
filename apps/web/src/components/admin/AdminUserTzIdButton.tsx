"use client";

import { useSession } from "next-auth/react";
import { useState } from "react";

export default function AdminUserTzIdButton({ userId, userName }: { userId: string; userName: string }) {
  const { data: session, status } = useSession();
  const [state, setState] = useState<"idle" | "loading" | "copied" | "error">("idle");
  const [error, setError] = useState("");
  if (status !== "authenticated" || session?.user?.role !== "ADMIN") return null;

  async function copy() {
    if (state === "loading") return;
    setState("loading");
    setError("");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Буфер обмена недоступен. Откройте сайт по HTTPS.");
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/tz-id`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(response.status === 403 || response.status === 401
          ? "Нет доступа. Обновите страницу и войдите как администратор."
          : response.status === 404 ? "Пользователь не найден." : "Не удалось получить TZ ID. Повторите попытку.");
      }
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || !("tzId" in data) || data.tzId !== userId) {
        throw new Error("Не удалось проверить TZ ID. Обновите страницу.");
      }
      try { await navigator.clipboard.writeText(userId); }
      catch { throw new Error("Не удалось скопировать. Разрешите доступ к буферу обмена и повторите попытку."); }
      setState("copied");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось скопировать TZ ID.");
      setState("error");
    }
  }

  return (
    <span className="inline-flex max-w-full flex-col items-start gap-1">
      <button type="button" onClick={copy} disabled={state === "loading"}
        aria-label={`Скопировать TZ ID пользователя ${userName}`}
        title="Скопировать только идентификатор TZ ID"
        className="min-h-[44px] min-w-[64px] rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-300 hover:bg-cyan-400/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:opacity-60">
        {state === "loading" ? "Копирование…" : "TZ ID"}
      </button>
      {state === "copied" && <span role="status" className="text-sm text-green-300">Скопировано</span>}
      {state === "error" && <span role="alert" className="max-w-xs break-words text-sm text-red-300">{error}</span>}
    </span>
  );
}
