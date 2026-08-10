"use client";

import { useState, useEffect } from "react";

// REFACTOR-A: вынесено из app/connect/page.tsx без изменений логики.
// Browser online/offline events catch a disabled adapter immediately. The
// same-origin probe also catches Wi-Fi that remains connected but has lost
// Internet access. Any HTTP response proves transport is back; only a fetch
// failure/timeout blocks the UI.
export function useConnectionProbe() {
  const [connectionLost, setConnectionLost] = useState(() =>
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    let activeController: AbortController | null = null;
    let wasLost = !navigator.onLine;

    const markLost = () => {
      if (!disposed) {
        wasLost = true;
        setConnectionLost(true);
        setReconnectAttempt((n) => n + 1);
      }
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

    const onOffline = () => markLost();
    const forceProbe = () => {
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
    const interval = window.setInterval(() => void probe(), 3000);
    void probe();
    return () => {
      disposed = true;
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
