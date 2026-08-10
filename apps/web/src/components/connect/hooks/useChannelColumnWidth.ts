"use client";

import { useState, useCallback } from "react";

/* REFACTOR-A: вынесено из app/connect/page.tsx без изменений.
   ── Resizable channel column (Discord-style drag between the channel list
   and the chat). Persisted so the chosen width survives reloads. ──
   Диапазон сужен, чтобы баннер в шапке группы не деформировался. */
export const CHANNEL_COL_MIN = 220;
export const CHANNEL_COL_MAX = 340;

export function useChannelColumnWidth() {
  const [channelColWidth, setChannelColWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 240;
    const saved = Number(localStorage.getItem("cn-channel-col-width"));
    return Number.isFinite(saved) && saved >= CHANNEL_COL_MIN && saved <= CHANNEL_COL_MAX ? saved : 240;
  });
  const updateChannelColWidth = useCallback((w: number) => {
    setChannelColWidth(w);
    if (typeof window !== "undefined") localStorage.setItem("cn-channel-col-width", String(Math.round(w)));
  }, []);
  return { channelColWidth, updateChannelColWidth };
}
