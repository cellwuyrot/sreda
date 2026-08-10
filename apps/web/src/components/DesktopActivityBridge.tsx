"use client";

/**
 * FIX-ACT: мост «активность с ПК» → статус профиля.
 *
 * Работает только внутри десктоп-оболочки (window.triozDesktop). Оболочка
 * присылает готовую фразу («Слушает музыку в Spotify») или null; мост
 * пересылает её в PUT /api/profile/activity. Сервер сохраняет активность,
 * только если пользователь включил чекбокс в настройках профиля, и показывает
 * её вместо пустого кастомного статуса, пока она свежая (TTL ~3 мин) — поэтому
 * здесь же периодический keepalive раз в минуту.
 */

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { getDesktopApi } from "@/lib/desktop";

const KEEPALIVE_MS = 60_000;

export function DesktopActivityBridge() {
  const { data: session } = useSession();
  const lastRef = useRef<string | null>(null);

  useEffect(() => {
    if (!session?.user) return;
    const api = getDesktopApi();
    if (!api?.onActivity) return; // обычный браузер или старая сборка шелла

    const send = (activity: string | null) => {
      fetch("/api/profile/activity", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activity }),
      }).catch(() => {});
    };

    const unsub = api.onActivity((label) => {
      lastRef.current = label;
      send(label);
    });
    const keepalive = setInterval(() => {
      if (lastRef.current) send(lastRef.current);
    }, KEEPALIVE_MS);

    return () => {
      unsub();
      clearInterval(keepalive);
    };
  }, [session]);

  return null;
}
