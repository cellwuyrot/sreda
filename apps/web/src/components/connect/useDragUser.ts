"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* FIX-USER-DND: Drag-and-drop для перемещения участника голосового канала.
   Отдельный хук — не смешивается с useDragOrder (группы/каналы).
   Источник: строка VoiceUserRow. Цель: любой голосовой канал.
   При сбросе — POST /api/voice/move-user. */

const START_DISTANCE = 6;

export type UserDragState = {
  draggingSocketId: string | null;
  overChannelId: string | null;
};

export function useDragUser({
  enabled,
  onMove,
}: {
  enabled: boolean;
  /** called when user is dropped on a voice channel */
  onMove: (socketId: string, userId: string, targetChannelId: string) => Promise<void>;
}) {
  const [dragging, setDragging] = useState<{ socketId: string; userId: string } | null>(null);
  const [overChannelId, setOverChannelId] = useState<string | null>(null);
  /* FIX-DND-SESSION: канал под курсором нужен и в обработчиках, и в разметке.
     В разметку он идёт состоянием (подсветка канала-цели), а в обработчики —
     рефом. Раньше обработчики читали состояние, из-за чего `overChannelId`
     стоял в зависимостях эффекта: первое же движение мыши над каналом меняло
     состояние, эффект перезапускался, его очистка вызывала reset() — и перенос
     обрывался ровно в тот момент, когда курсор доходил до цели. */
  const overChannelRef = useRef<string | null>(null);
  const session = useRef<{
    socketId: string;
    userId: string;
    x: number; y: number;
    started: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const onMoveRef = useRef(onMove);
  useEffect(() => { onMoveRef.current = onMove; }, [onMove]);

  const reset = useCallback(() => {
    session.current = null;
    overChannelRef.current = null;
    setDragging(null);
    setOverChannelId(null);
    if (typeof document !== "undefined") {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const onMove_ = (e: PointerEvent) => {
      const s = session.current;
      if (!s) return;
      if (!s.started) {
        if (Math.abs(e.clientX - s.x) + Math.abs(e.clientY - s.y) < START_DISTANCE) return;
        s.started = true;
        setDragging({ socketId: s.socketId, userId: s.userId });
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
      }
      // Find voice channel under cursor — target elements have data-voice-channel-id
      let el: Element | null = document.elementFromPoint(e.clientX, e.clientY);
      let found: string | null = null;
      while (el) {
        if (el instanceof HTMLElement) {
          const cid = el.dataset.voiceChannelId;
          if (cid) { found = cid; break; }
        }
        el = el.parentElement;
      }
      overChannelRef.current = found;
      setOverChannelId(found);
    };

    const onUp = (e: PointerEvent) => {
      const s = session.current;
      const channelId = overChannelRef.current;
      reset();
      if (!s || !s.started) return;
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 300);
      // Find drop target at release point
      let el: Element | null = document.elementFromPoint(e.clientX, e.clientY);
      let targetChannelId: string | null = null;
      while (el) {
        if (el instanceof HTMLElement) {
          const cid = el.dataset.voiceChannelId;
          if (cid) { targetChannelId = cid; break; }
        }
        el = el.parentElement;
      }
      if (!targetChannelId) {
        // Fallback: последний канал, над которым проходил курсор
        targetChannelId = channelId;
      }
      if (targetChannelId) {
        void onMoveRef.current(s.socketId, s.userId, targetChannelId);
      }
    };

    window.addEventListener("pointermove", onMove_);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", reset);
    return () => {
      window.removeEventListener("pointermove", onMove_);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", reset);
      reset();
    };
  }, [enabled, reset]);

  /* Props to spread on a user row (drag source) */
  const userRowProps = (socketId: string, userId: string) => {
    if (!enabled) return {};
    return {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType !== "mouse" || e.button !== 0) return;
        e.preventDefault();   // FIX-DND: блокирует выделение текста и нативный браузерный drag
        e.stopPropagation(); // prevent channel/group drag from starting
        session.current = { socketId, userId, x: e.clientX, y: e.clientY, started: false };
      },
      onClickCapture: (e: React.MouseEvent) => {
        if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); }
      },
      // FIX-DND: userSelect+touchAction не дают браузеру перехватить pointer до начала drag
      style: { cursor: "grab", userSelect: "none", touchAction: "none" } as React.CSSProperties,
    };
  };

  /* Class for user row while dragging */
  const userRowClass = (socketId: string) =>
    dragging?.socketId === socketId ? "opacity-40" : "";

  /* Props to spread on a voice channel drop zone */
  const channelDropProps = (channelId: string) => ({
    "data-voice-channel-id": channelId,
  });

  /* Class for a voice channel that is currently hovered */
  const channelDropClass = (channelId: string) =>
    overChannelId === channelId && dragging
      ? " ring-1 ring-violet-500/70 dark:ring-cyan-400/70 rounded-lg bg-violet-50/30 dark:bg-cyan-400/5"
      : "";

  return { dragging, overChannelId, userRowProps, userRowClass, channelDropProps, channelDropClass };
}
