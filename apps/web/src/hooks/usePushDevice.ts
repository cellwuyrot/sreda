"use client";

import { useEffect, useRef } from "react";

/**
 * PUSH: привязка устройства к аккаунту, чтобы уведомления доходили в ЗАКРЫТОЕ
 * приложение.
 *
 * ── Как это работает и почему так ───────────────────────────────────────────
 *
 * Адрес устройства выдаёт служба доставки самому приложению-оболочке, а привязать
 * его нужно к аккаунту — то есть выполнить запрос от имени вошедшего человека.
 * Проще всего это сделать со страницы: сессия у неё уже есть. Поэтому оболочка
 * ничего не отправляет сама, а лишь отдаёт адрес по запросу, а привязку делает
 * этот хук.
 *
 * Обратный путь (оболочка сама шлёт запрос) означал бы тащить в нативный слой
 * работу с cookie сессии — лишний код там, где он не нужен, и второй способ
 * авторизации, который придётся поддерживать.
 *
 * В обычном браузере хук не делает ничего: доставка в закрытую вкладку — это
 * отдельная история (служебный воркёр), и её здесь нет.
 */

interface ShellPushBridge {
  /** Адрес устройства в службе доставки. Пусто — служба недоступна. */
  pushToken?(): string;
}

function bridge(): ShellPushBridge | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { AndroidNotify?: ShellPushBridge }).AndroidNotify;
  return api && typeof api.pushToken === "function" ? api : null;
}

/** Прочитать адрес устройства у оболочки. Пусто — привязывать нечего. */
export function readShellPushToken(): string {
  const api = bridge();
  if (!api) return "";
  try {
    return (api.pushToken?.() || "").trim();
  } catch {
    /* оболочка старой версии без этого моста */
    return "";
  }
}

export function usePushDevice(userId: string | undefined): void {
  /* Что уже привязано в этом запуске страницы. Адрес меняется редко, а запрос на
     каждое переключение вкладки — лишний шум в журнале сервера. */
  const registered = useRef<string>("");

  useEffect(() => {
    if (!userId) return;

    async function register() {
      const token = readShellPushToken();
      if (!token || token === registered.current) return;
      try {
        const res = await fetch("/api/push/devices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ token, platform: "android" }),
        });
        if (res.ok) registered.current = token;
      } catch {
        /* сеть пропала — попробуем при следующем возвращении в приложение */
      }
    }

    void register();

    /* Возвращение в приложение — самый естественный момент повторить попытку:
       адрес устройства мог смениться, пока приложение было закрыто, и тогда
       уведомления шли бы «в никуда». */
    function onVisible() {
      if (document.visibilityState === "visible") void register();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [userId]);
}

/**
 * Отвязать устройство при выходе из аккаунта.
 *
 * Без этого на телефоне остался бы адрес, привязанный к прежнему человеку: до
 * следующего входа уведомления продолжали бы приходить ему. Повторный вход
 * переприязывает адрес и без этого вызова (см. маршрут), но полагаться на
 * «кто-нибудь войдёт» нельзя — выход должен закрывать доступ сразу.
 */
export async function unregisterShellPushDevice(): Promise<void> {
  const token = readShellPushToken();
  if (!token) return;
  try {
    await fetch("/api/push/devices", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token }),
    });
  } catch {
    /* выход важнее: молчим и не мешаем человеку выйти */
  }
}
