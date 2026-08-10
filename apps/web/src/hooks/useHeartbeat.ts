"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";

const HEARTBEAT_INTERVAL = 30_000; // 30 seconds

export function useHeartbeat() {
  const { data: session } = useSession();

  useEffect(() => {
    if (!session?.user) return;

    const ping = () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 4000);
      fetch("/api/heartbeat", { method: "POST", signal: controller.signal })
        .catch(() => {})
        .finally(() => window.clearTimeout(timeout));
    };

    ping();
    const interval = setInterval(ping, HEARTBEAT_INTERVAL);
    // A VPN/network-interface change may keep navigator.onLine=true. Focus,
    // online and Network Information changes all trigger an immediate retry.
    const onNetworkChange = () => ping();
    const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
    window.addEventListener("online", onNetworkChange);
    window.addEventListener("focus", onNetworkChange);
    connection?.addEventListener("change", onNetworkChange);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", onNetworkChange);
      window.removeEventListener("focus", onNetworkChange);
      connection?.removeEventListener("change", onNetworkChange);
    };
  }, [session]);
}
