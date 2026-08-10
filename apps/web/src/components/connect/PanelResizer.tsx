"use client";

import { useCallback, useRef } from "react";

interface PanelResizerProps {
  /** Current width of the panel to the left, in pixels. */
  width: number;
  /** Smallest / largest widths the panel may be dragged to. */
  min: number;
  max: number;
  /** Called continuously while dragging with the new (clamped) width. */
  onChange: (width: number) => void;
  /** FIX-B9: ширина, восстанавливаемая двойным кликом (клампится в [min, max]). */
  resetWidth?: number;
  /** FIX-UI2: с какой стороны от рукоятки находится ресайзящаяся панель. */
  edge?: "left" | "right";
}

/**
 * A thin vertical drag handle that sits between two columns and resizes the
 * column on its left — the same affordance Discord puts between its channel list
 * and the chat. It's a 1px seam with a comfortably wider invisible hit area, so
 * it's easy to grab without stealing clicks from the content beside it.
 *
 * FIX-B9: переведено на Pointer Events + setPointerCapture — теперь работает
 * и на сенсорных экранах десктопной ширины, а не только с мышью.
 *
 * The drag maths are anchored to where the grab began (`startX` / `startW`)
 * rather than to the live `width` prop, so a re-render mid-drag can't make the
 * handle jump. While dragging we set a body-wide `col-resize` cursor and disable
 * text selection so the pointer feels locked to the seam.
 */
export default function PanelResizer({ width, min, max, onChange, resetWidth = 240, edge = "left" }: PanelResizerProps) {
  const dragRef = useRef<{ pointerId: number; startX: number; startW: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startW: width };
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragRef.current;
    if (!start || e.pointerId !== start.pointerId) return;
    /* FIX-UI2: для панели справа от рукоятки движение вправо сужает её */
    const dx = e.clientX - start.startX;
    onChange(Math.min(max, Math.max(min, start.startW + (edge === "left" ? dx : -dx))));
  }, [min, max, onChange, edge]);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragRef.current;
    if (!start || e.pointerId !== start.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  /* FIX-B9: сброс больше не жёстко зашит в 240 — клампится в границы [min, max] */
  const onDoubleClick = useCallback(
    () => onChange(Math.min(max, Math.max(min, resetWidth))),
    [min, max, onChange, resetWidth],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onDoubleClick}
      title="Перетащите, чтобы изменить ширину (двойной клик — сброс)"
      className="hidden md:block group relative w-px flex-shrink-0 cursor-col-resize self-stretch"
      style={{ background: "var(--cn-border)", touchAction: "none" }}
    >
      {/* Wide invisible hit area centred on the 1px seam. */}
      <span className="absolute inset-y-0 -left-1.5 -right-1.5 z-10" />
      {/* Accent highlight on hover / active drag. */}
      <span className="absolute inset-y-0 -left-px -right-px bg-accent/0 group-hover:bg-accent/60 group-active:bg-accent transition-colors" />
    </div>
  );
}
