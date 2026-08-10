"use client";

import { useState, useEffect } from "react";
import { getDesktopApi } from "@/lib/desktop";

/* REFACTOR-A: вынесено из app/connect/page.tsx без изменений.
   Блокировка по IP/устройству (MAC). Клиент регистрирует своё
   устройство на сервере; если IP или устройство заблокированы — полное
   скелетирование, как при глобальном бане. В десктопе ID устройства —
   хэш MAC-адресов; в браузере — постоянный случайный ID (MAC браузеру недоступен). */
export function useDeviceIdentity() {
  const [identityBlocked, setIdentityBlocked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let deviceId: string | null = null;
      try {
        deviceId = (await getDesktopApi()?.getDeviceId?.()) ?? null;
      } catch {
        deviceId = null; // старая сборка десктопа без getDeviceId
      }
      if (!deviceId) {
        try {
          deviceId = localStorage.getItem("tz-device-id");
          if (!deviceId) {
            deviceId = crypto.randomUUID();
            localStorage.setItem("tz-device-id", deviceId);
          }
        } catch {
          deviceId = null;
        }
      }
      try {
        if (deviceId) document.cookie = `tz-device=${deviceId}; path=/; max-age=31536000; samesite=lax`;
      } catch {
        /* ignore */
      }
      try {
        const res = await fetch("/api/device", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId }),
        });
        if (!cancelled && res.ok) {
          const data = await res.json().catch(() => null);
          if (data?.blocked) setIdentityBlocked(true);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return identityBlocked;
}
