"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { useAdminBackHref, useAdminBackLabel } from "@/components/admin/useAdminBackHref";

/**
 * Раздел «Уведомления» админской и редакторской.
 *
 * Здесь один переключатель — обратная связь по почте. Обращения приходят в
 * очередь и уведомлением в колокольчик, но колокольчик работает, только пока
 * человек в приложении: заявка, поданная ночью, лежит до того, как кто-нибудь
 * заглянет. Письмо — единственный канал, который достаёт вне приложения, и оно
 * идёт через тот же почтовый сервис, что рассылает коды входа: отдельной
 * настройки нет и не нужно.
 *
 * Настройка личная, а не общая на проект: у каждого своя мера терпимости к
 * письмам, и выключение у одного не должно лишать писем остальных.
 *
 * Экран намеренно пустой: тут нечего настраивать, кроме этого. Подсказка — за
 * знаком вопроса, чтобы не превращать настройку в инструкцию.
 */
export default function AdminNotificationsPage() {
  const backHref = useAdminBackHref();
  const backLabel = useAdminBackLabel();
  const { data: session, status } = useSession();
  const router = useRouter();

  const [emailEnabled, setEmailEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [hint, setHint] = useState(false);

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN" && session?.user?.role !== "EDITOR") {
      router.push("/");
    }
  }, [session, status, router]);

  useEffect(() => {
    fetch("/api/profile/notifications", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.notifyEmail === "boolean") setEmailEnabled(data.notifyEmail);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  /* Сохраняем сразу по переключению, без кнопки «Сохранить»: настройка одна, и
     отдельное действие для неё — лишний шаг. При ошибке возвращаем как было,
     иначе галочка врёт о состоянии. */
  const toggle = useCallback(async (next: boolean) => {
    setEmailEnabled(next);
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch("/api/profile/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifyEmail: next }),
      });
      if (!res.ok) throw new Error("save failed");
      setNote(next ? "Письма включены" : "Письма выключены");
    } catch {
      setEmailEnabled(!next);
      setNote("Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }, []);

  if (status === "loading") return <div className="p-8 text-white/60">Загрузка…</div>;

  return (
    <div className="min-h-screen text-white p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href={backHref} className="text-sm text-white/60 hover:text-white">{backLabel}</Link>
      </div>
      <h1 className="text-3xl font-bold mb-1">Уведомления</h1>
      <p className="text-white/50 mb-6">Как узнавать о новых обращениях</p>

      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={emailEnabled}
            disabled={loading || saving}
            onChange={(e) => void toggle(e.target.checked)}
            className="w-4 h-4 rounded border-white/20 text-violet-500 dark:text-cyan-500 focus:ring-violet-500 dark:focus:ring-cyan-500"
          />
          <span className="text-sm">Обратная связь по почте</span>
          <button
            type="button"
            onClick={() => setHint((v) => !v)}
            aria-label="Что это"
            className="w-5 h-5 rounded-full border border-white/20 text-[11px] text-white/60 hover:text-white hover:border-white/40"
          >
            ?
          </button>
        </label>

        {hint && (
          <p className="mt-3 text-xs text-white/50 leading-relaxed">
            На почту аккаунта приходит письмо о новом обращении и о дополнении от клиента.
            Отправляет тот же сервис, что рассылает коды входа. Уведомление в колокольчике
            остаётся включённым в любом случае — выключается только письмо.
          </p>
        )}

        {note && <p className="mt-3 text-xs text-white/40">{note}</p>}
      </div>
    </div>
  );
}
