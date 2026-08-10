"use client";

import { useState, useEffect } from "react";

/* REFACTOR-A: вынесено из app/connect/page.tsx без изменений.
   FIX-B3: активная ветка вёрстки. Мобильное и десктопное деревья больше не
   монтируются одновременно — MessageArea не живёт в DOM дважды (нет двойных
   сокет-подписок и дублирующихся запросов). */
export function useDesktopViewport() {
  const [isDesktopViewport, setIsDesktopViewport] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktopViewport(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isDesktopViewport;
}
