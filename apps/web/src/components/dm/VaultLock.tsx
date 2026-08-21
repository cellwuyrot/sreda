"use client";

import { useEffect, useRef, useState } from "react";
import { VaultIcon } from "@/components/ui/ConnectIcons";

/* FIX-VAULTPW: замок «Сейфа».

   Разблокировка живёт только в состоянии панели, а не в localStorage: закрыли
   вкладку — Сейф снова закрыт. Пока закрыт, переписка и поле ввода не
   отрисовываются вообще — а не прячутся под размытием, иначе достаточно было
   бы отключить стили.

   FIX-VAULTFORGOT: четыре явных шага вместо двух.
     create  — пароля ещё нет, его придумывают (с повтором);
     enter   — пароль есть, его вводят, рядом с полем есть «Не помню»;
     account — забыл: вводится пароль от аккаунта;
     reset   — пароль аккаунта подтверждён, задаётся новый пароль Сейфа.

   Шаг reset обязателен: если пускать внутрь сразу по паролю аккаунта, замок
   остался бы с прежним забытым паролем, и в следующий раз человек снова
   упёрся бы в ту же стену. */

type Stage = "loading" | "create" | "enter" | "account" | "reset";

export default function VaultLock({ onUnlocked }: { onUnlocked: () => void }) {
  const [stage, setStage] = useState<Stage>("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  /* Пароль аккаунта держим до конца шага reset: смена пароля Сейфа — это
     отдельный запрос, и он тоже должен доказать право на смену. */
  const [accountPassword, setAccountPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/dm/vault", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { hasPassword: false }))
      .then((d: { hasPassword?: boolean }) => {
        if (alive) setStage(d.hasPassword ? "enter" : "create");
      })
      .catch(() => {
        if (alive) setStage("create");
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (stage !== "loading") inputRef.current?.focus();
  }, [stage]);

  const goToAccount = () => {
    setError(null);
    setPassword("");
    setConfirm("");
    setStage("account");
  };

  const backToEnter = () => {
    setError(null);
    setPassword("");
    setConfirm("");
    setAccountPassword("");
    setStage("enter");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!password) {
      setError(stage === "account" ? "Введите пароль от аккаунта" : "Введите пароль");
      return;
    }
    if ((stage === "create" || stage === "reset") && password !== confirm) {
      setError("Пароли не совпадают");
      return;
    }

    setBusy(true);
    try {
      /* Шаг reset идёт через PUT — это смена пароля, подтверждённая паролем
         аккаунта. Остальные шаги — POST. */
      const res =
        stage === "reset"
          ? await fetch("/api/dm/vault", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ password, accountPassword }),
            })
          : await fetch("/api/dm/vault", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify(
                stage === "account" ? { password, mode: "account" } : { password }
              ),
            });

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        resetRequired?: boolean;
      };

      if (!res.ok) {
        setError(data.error || "Не удалось открыть Сейф");
        return;
      }

      /* Пароль аккаунта принят — но Сейф пока не открываем: сначала новый
         пароль Сейфа. */
      if (stage === "account") {
        setAccountPassword(password);
        setPassword("");
        setConfirm("");
        setStage("reset");
        return;
      }

      setPassword("");
      setConfirm("");
      setAccountPassword("");
      onUnlocked();
    } catch {
      setError("Сеть недоступна — попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  };

  const needsConfirm = stage === "create" || stage === "reset";

  const hint =
    stage === "loading"
      ? "Проверяем доступ…"
      : stage === "create"
        ? "Придумайте пароль — он понадобится при каждом входе в Сейф."
        : stage === "enter"
          ? "Введите пароль, чтобы открыть сохранённое."
          : stage === "account"
            ? "Введите пароль от аккаунта — тот, с которым вы входите в TrioZ. Содержимое Сейфа при этом не теряется."
            : "Пароль аккаунта подтверждён. Задайте новый пароль Сейфа — старый перестанет действовать.";

  const buttonLabel = busy
    ? "Проверяем…"
    : stage === "create"
      ? "Задать пароль и открыть"
      : stage === "account"
        ? "Подтвердить"
        : stage === "reset"
          ? "Сохранить и открыть"
          : "Открыть Сейф";

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
        <p className="mt-1 text-xs text-[var(--cn-text-dim)]">{hint}</p>

        <div className="mt-4 flex items-center gap-2">
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              stage === "create"
                ? "Новый пароль"
                : stage === "account"
                  ? "Пароль от аккаунта"
                  : stage === "reset"
                    ? "Новый пароль Сейфа"
                    : "Пароль"
            }
            autoComplete={
              stage === "account"
                ? "current-password"
                : needsConfirm
                  ? "new-password"
                  : "current-password"
            }
            className="w-full min-w-0 flex-1 rounded-xl border border-[var(--cn-border)] bg-transparent px-3 py-2 text-sm text-[var(--cn-text)] outline-none focus:border-violet-500 dark:focus:border-cyan-400"
          />
          {/* FIX-VAULTFORGOT: выход из тупика стоит рядом с полем ввода, а не
              прячется внизу: человек ищет его именно в тот момент, когда
              смотрит на поле и понимает, что не помнит пароль. */}
          {stage === "enter" && (
            <button
              type="button"
              onClick={goToAccount}
              className="shrink-0 whitespace-nowrap rounded-xl border border-[var(--cn-border)] px-3 py-2 text-xs text-[var(--cn-text-dim)] transition-colors hover:text-[var(--cn-text)]"
            >
              Не помню
            </button>
          )}
        </div>

        {needsConfirm && (
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
          disabled={busy || stage === "loading"}
          className="mt-4 w-full rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50 dark:bg-cyan-500 dark:hover:bg-cyan-400"
        >
          {buttonLabel}
        </button>

        {(stage === "account" || stage === "reset") && (
          <button
            type="button"
            onClick={backToEnter}
            disabled={busy}
            className="mt-2 w-full rounded-xl px-4 py-2 text-xs text-[var(--cn-text-dim)] transition-colors hover:text-[var(--cn-text)] disabled:opacity-50"
          >
            Вспомнил пароль Сейфа
          </button>
        )}
      </form>
    </div>
  );
}
