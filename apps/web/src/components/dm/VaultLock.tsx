"use client";

import { useEffect, useRef, useState } from "react";
import { VaultIcon } from "@/components/ui/ConnectIcons";

/* FIX-VAULTPW: замок «Сейфа».

   Два состояния, и оба явные: пароля ещё нет — его придумывают (с повтором,
   потому что восстановить его нечем), пароль есть — его вводят. Разблокировка
   живёт только в состоянии панели, а не в localStorage: закрыли вкладку — Сейф
   снова закрыт. Пока закрыт, переписка и поле ввода не отрисовываются вообще —
   а не прячутся под размытием, иначе достаточно было бы отключить стили. */

export default function VaultLock({ onUnlocked }: { onUnlocked: () => void }) {
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/dm/vault", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { hasPassword: false }))
      .then((d: { hasPassword?: boolean }) => {
        if (alive) setHasPassword(!!d.hasPassword);
      })
      .catch(() => {
        if (alive) setHasPassword(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (hasPassword !== null) inputRef.current?.focus();
  }, [hasPassword]);

  const first = hasPassword === false;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!password) {
      setError("Введите пароль");
      return;
    }
    if (first && password !== confirm) {
      setError("Пароли не совпадают");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/dm/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Не удалось открыть Сейф");
        return;
      }
      setPassword("");
      setConfirm("");
      onUnlocked();
    } catch {
      setError("Сеть недоступна — попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 min-h-0 items-center justify-center overflow-y-auto px-4 py-8">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-[var(--cn-border)] bg-[var(--cn-sidebar)] p-6 text-center shadow-lg"
      >
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-[var(--cn-border)] text-[var(--cn-text-dim)]">
          <VaultIcon size={24} style={{ color: "inherit" }} />
        </div>
        <h2 className="text-base font-semibold text-[var(--cn-text)]">Сейф</h2>
        <p className="mt-1 text-xs text-[var(--cn-text-dim)]">
          {hasPassword === null
            ? "Проверяем доступ…"
            : first
              ? "Придумайте пароль — он понадобится при каждом входе в Сейф. Восстановить его нельзя."
              : "Введите пароль, чтобы открыть сохранённое."}
        </p>

        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={first ? "Новый пароль" : "Пароль"}
          autoComplete={first ? "new-password" : "current-password"}
          className="mt-4 w-full rounded-xl border border-[var(--cn-border)] bg-transparent px-3 py-2 text-sm text-[var(--cn-text)] outline-none focus:border-violet-500 dark:focus:border-cyan-400"
        />
        {first && (
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Повторите пароль"
            autoComplete="new-password"
            className="mt-2 w-full rounded-xl border border-[var(--cn-border)] bg-transparent px-3 py-2 text-sm text-[var(--cn-text)] outline-none focus:border-violet-500 dark:focus:border-cyan-400"
          />
        )}

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={busy || hasPassword === null}
          className="mt-4 w-full rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50 dark:bg-cyan-500 dark:hover:bg-cyan-400"
        >
          {busy ? "Проверяем…" : first ? "Задать пароль и открыть" : "Открыть Сейф"}
        </button>
      </form>
    </div>
  );
}
