"use client";

/**
 * FIX-NAV1: мост «оболочка просит навигацию» → мягкий переход внутри SPA.
 *
 * Раньше десктоп-оболочка открывала ссылки из уведомлений/нижней плашки через
 * полную перезагрузку страницы (window.location.assign / loadURL). Это
 * размонтировало корневое React-дерево вместе с VoiceProvider и молча выкидывало
 * пользователя из активного голосового канала — ровно тот баг, на который
 * жаловались («при нажатии на уведомление снизу происходит выход из голоса»).
 *
 * Теперь main пересылает путь через IPC.NAVIGATE, а этот мост выполняет переход
 * БЕЗ перезагрузки:
 *   • тот же раздел /connect (мы уже в нём) — рассылаем DOM-событие
 *     `tz-desktop-navigate`, и страница /connect переключает секцию на месте;
 *   • иначе — обычный клиентский router.push (VoiceProvider живёт в корневом
 *     layout и переживает смену маршрута, звонок не прерывается).
 *
 * В обычном браузере (нет window.triozDesktop.onNavigate) компонент — no-op.
 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getDesktopApi } from "@/lib/desktop";

export function DesktopNavigationBridge() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const api = getDesktopApi();
    if (!api?.onNavigate) return; // обычный браузер или старая сборка шелла

    const unsub = api.onNavigate((rawPath) => {
      if (typeof rawPath !== "string" || !rawPath) return;
      let url: URL;
      try {
        url = new URL(rawPath, window.location.origin);
      } catch {
        return;
      }

      const targetIsConnect = url.pathname === "/connect";
      const alreadyOnConnect = pathname === "/connect";

      if (targetIsConnect && alreadyOnConnect) {
        // Мягкое переключение раздела внутри уже открытого /connect — без
        // маршрутизации и без перезагрузки. Страница слушает это событие и
        // применяет ?section=/dm=/group= так же, как при первом монтировании.
        window.dispatchEvent(
          new CustomEvent<string>("tz-desktop-navigate", { detail: url.search }),
        );
        return;
      }

      // Переход на другой маршрут (в т.ч. вход в /connect из другого раздела).
      // Клиентская навигация Next сохраняет корневой layout смонтированным,
      // поэтому VoiceProvider и активный звонок не теряются.
      router.push(`${url.pathname}${url.search}`);
    });

    return () => unsub();
  }, [router, pathname]);

  return null;
}
