"use client";

import { useState, useEffect } from "react";

// REFACTOR-A: вынесено из app/connect/page.tsx без изменений логики.
// Browser online/offline events catch a disabled adapter immediately. The
// same-origin probe also catches Wi-Fi that remains connected but has lost
// Internet access. Any HTTP response proves transport is back; only a fetch
// failure/timeout blocks the UI.
/** Шаг опроса сервера. */
const PROBE_MS = 3000;
/** Сколько промахов подряд считать настоящей потерей связи (~10 с). */
const MISS_LIMIT = 4;
/** Сколько ждём после события offline, прежде чем верить ему. */
const OFFLINE_GRACE_MS = 7000;

export function useConnectionProbe() {
  const [connectionLost, setConnectionLost] = useState(() =>
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    let activeController: AbortController | null = null;
    let wasLost = !navigator.onLine;
    /* NET-GRACE: сколько проверок подряд не дошло до сервера. Раньше шит «Соединение
       потеряно» всплывал от одного промаха: хватало переключения Wi-Fi между точками,
       секундной просадки мобильного или просто медленного ответа. Короткие провалы
       браузер переживает сам, и человеку о них знать не надо. */
    let missStreak = 0;
    let offlineTimer: number | null = null;

    const clearOfflineTimer = () => {
      if (offlineTimer !== null) {
        window.clearTimeout(offlineTimer);
        offlineTimer = null;
      }
    };

    const markLost = () => {
      if (disposed) return;
      missStreak += 1;
      /* Шит показываем только когда связи нет устойчиво: MISS_LIMIT проверок подряд
         при шаге PROBE_MS — это около десяти секунд тишины. */
      if (missStreak < MISS_LIMIT) return;
      wasLost = true;
      setConnectionLost(true);
      setReconnectAttempt(missStreak - MISS_LIMIT + 1);
    };

    const probe = async () => {
      if (disposed || activeController) return;
      if (!navigator.onLine) { markLost(); return; }
      const controller = new AbortController();
      activeController = controller;
      const timeout = window.setTimeout(() => controller.abort(), 2500);
      try {
        await fetch(`/api/auth/session?connectionProbe=${Date.now()}`, {
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
        });
        if (!disposed) {
          missStreak = 0;
          clearOfflineTimer();
          setConnectionLost(false);
          setReconnectAttempt(0);
          if (wasLost) {
            wasLost = false;
            // Long-lived components can immediately refresh their data after
            // a VPN route switch instead of waiting for their next interval.
            window.dispatchEvent(new Event("tz-network-restored"));
          }
        }
      } catch {
        // An explicit forceProbe aborts the stale request from the previous IP.
        // Do not briefly show the offline shield for that expected cancellation.
        if (!disposed && !(controller.signal.aborted && activeController !== controller)) markLost();
      } finally {
        window.clearTimeout(timeout);
        if (activeController === controller) activeController = null;
      }
    };

    /* Событие offline тоже не приговор: адаптер мигает при смене точки доступа и
       при включении VPN. Даём сети время вернуться самой. */
    const onOffline = () => {
      if (disposed || offlineTimer !== null) return;
      offlineTimer = window.setTimeout(() => {
        offlineTimer = null;
        if (!disposed && !navigator.onLine) {
          missStreak = MISS_LIMIT - 1;
          markLost();
        }
      }, OFFLINE_GRACE_MS);
    };
    const forceProbe = () => {
      clearOfflineTimer();
      activeController?.abort();
      activeController = null;
      void probe();
    };
    const onVisibility = () => { if (document.visibilityState === "visible") forceProbe(); };
    const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", forceProbe);
    window.addEventListener("focus", forceProbe);
    document.addEventListener("visibilitychange", onVisibility);
    connection?.addEventListener("change", forceProbe);
    const interval = window.setInterval(() => void probe(), PROBE_MS);
    void probe();
    return () => {
      disposed = true;
      clearOfflineTimer();
      activeController?.abort();
      window.clearInterval(interval);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", forceProbe);
      window.removeEventListener("focus", forceProbe);
      document.removeEventListener("visibilitychange", onVisibility);
      connection?.removeEventListener("change", forceProbe);
    };
  }, []);

  return { connectionLost, reconnectAttempt };
}
