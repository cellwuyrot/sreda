"use client";

import { useState, useEffect } from "react";
import type { Session } from "next-auth";

/* REFACTOR-A: вынесено из app/connect/page.tsx без изменений.
   FIX: помним, что в этой вкладке уже была живая сессия — обновление страницы
   или потеря сети не должны показывать экран входа («иллюзия выхода»).
   Флаг держим в state (его можно читать во время рендера, в отличие от ref)
   и зеркалим в sessionStorage, чтобы он пережил перезагрузку вкладки. */
export function useHadSession(
  session: Session | null,
  status: "authenticated" | "loading" | "unauthenticated",
) {
  const [hadSession, setHadSession] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    /* FIX-RELOGIN: флаг живёт в localStorage — он переживает перезагрузку
       вкладки и перезапуск десктоп-приложения, поэтому рестарт сервера больше
       не выглядит как выход из аккаунта с просьбой ввести логин и пароль. */
    try {
      return localStorage.getItem("tz-had-session") === "1" || sessionStorage.getItem("tz-had-session") === "1";
    } catch { return false; }
  });
  useEffect(() => {
    if (session?.user && !hadSession) {
      setHadSession(true);
      try { localStorage.setItem("tz-had-session", "1"); } catch { /* noop */ }
    }
  }, [session, hadSession]);

  /* FIX-RELOGIN: пока показан экран «Восстанавливаем сессию…», периодически
     спрашиваем сервер напрямую. Если сервер доступен и сессия жива —
     перезагружаем страницу (next-auth заново прочитает cookie и вернёт вас в
     приложение без логина и пароля). Если сервер доступен, но сессии
     действительно нет — это настоящий выход: снимаем флаг и показываем обычный
     экран входа. Пока сервер перезагружается и не отвечает — просто ждём. */
  useEffect(() => {
    if (status === "loading" || session?.user || !hadSession) return;
    let disposed = false;
    const check = async () => {
      try {
        const res = await fetch(`/api/auth/session?reloginProbe=${Date.now()}`, {
          cache: "no-store",
          credentials: "include",
        });
        if (disposed || !res.ok) return;
        const data: unknown = await res.json().catch(() => null);
        if (disposed) return;
        if (data && typeof data === "object" && (data as { user?: unknown }).user) {
          window.location.reload();
        } else {
          setHadSession(false);
          try {
            localStorage.removeItem("tz-had-session");
            sessionStorage.removeItem("tz-had-session");
          } catch { /* noop */ }
        }
      } catch { /* сервер ещё недоступен — пробуем на следующем тике */ }
    };
    const timer = window.setInterval(() => void check(), 3000);
    void check();
    return () => { disposed = true; window.clearInterval(timer); };
  }, [status, session, hadSession]);

  // Ссылка «Войти заново» на экране «Восстанавливаем сессию…».
  const clearHadSession = () => {
    setHadSession(false);
    try {
      localStorage.removeItem("tz-had-session");
      sessionStorage.removeItem("tz-had-session");
    } catch { /* noop */ }
  };

  return { hadSession, clearHadSession };
}
