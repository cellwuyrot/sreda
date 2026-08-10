"use client";

/**
 * ANDROID-LOCK: страж навигации внутри Android-оболочки Connect.
 *
 * Оболочка (apps/android) — клиент строго раздела /connect. Нативный слой
 * перехватывает только полные загрузки страниц (shouldOverrideUrlLoading) и
 * SPA-переходы задним числом (doUpdateVisitedHistory → возврат на /connect с
 * перезагрузкой). Чтобы пользователь вообще не «выпадал» из мессенджера и не
 * терял состояние (голосовой канал, набранный текст), клики по внутренним
 * ссылкам вне allowlist глушатся ещё на веб-стороне — до того, как Next Link
 * успеет выполнить client-side навигацию.
 *
 * В обычном браузере и в Electron компонент — no-op.
 */

import { useEffect } from "react";
import { isAndroidShell, isAllowedShellPath } from "@/lib/shell";

export function AndroidShellGuard() {
  useEffect(() => {
    if (!isAndroidShell()) return;

    // Страховка: класс ставит anti-flash скрипт в layout ещё до первой
    // отрисовки; здесь повторяем на случай старых сборок разметки.
    document.documentElement.classList.add("tz-android");

    /* Capture-фаза: перехватываем раньше обработчиков Next <Link>. */
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;

      const href = anchor.getAttribute("href") ?? "";
      // Якоря и js-ссылки не трогаем.
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;

      let url: URL;
      try {
        url = new URL(href, window.location.origin);
      } catch {
        return;
      }

      // Чужой origin (и не-http схемы) отдаём нативному слою: оболочка
      // откроет их в системном браузере (Config.isExternal → openExternally).
      if (url.origin !== window.location.origin) return;

      if (!isAllowedShellPath(url.pathname)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
