"use client";

import { useRef } from "react";

type CSS = React.CSSProperties;

/**
 * A thin draggable divider for resizing a table column (axis "x", dragged
 * horizontally) or a row (axis "y", dragged vertically). It reports the new,
 * clamped size to `onResize` as the pointer moves.
 *
 * The handle grabs the pointer (`setPointerCapture`) so the drag keeps tracking
 * even when the cursor leaves the sliver of the divider. When the table lives
 * inside the zoomable canvas its CSS pixels are scaled by the current camera
 * zoom, so `scale` converts the on-screen pointer delta back into layout pixels
 * — that keeps a column edge glued to the cursor at any zoom level.
 */
export function GridResizeHandle({
  axis,
  size,
  min,
  max,
  scale = 1,
  onResize,
  title,
}: {
  axis: "x" | "y";
  size: number;
  min: number;
  max: number;
  scale?: number;
  onResize: (next: number) => void;
  title?: string;
}) {
  const startPos = useRef(0);
  const startSize = useRef(size);
  const dragging = useRef(false);

  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)));

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    startPos.current = axis === "x" ? e.clientX : e.clientY;
    startSize.current = size;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = (axis === "x" ? e.clientX : e.clientY) - startPos.current;
    onResize(clamp(startSize.current + delta / (scale || 1)));
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };

  const style: CSS =
    axis === "x"
      ? { position: "absolute", top: 0, right: -4, height: "100%", width: 9 }
      : { position: "absolute", left: 0, bottom: -4, width: "100%", height: 9 };

  const lineClass =
    axis === "x"
      ? "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-neutral-400 dark:group-hover:bg-neutral-500"
      : "absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-transparent transition-colors group-hover:bg-neutral-400 dark:group-hover:bg-neutral-500";

  return (
    <span
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      title={
        title ??
        (axis === "x" ? "Потяните, чтобы изменить ширину столбца" : "Потяните, чтобы изменить высоту строки")
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={(e) => e.stopPropagation()}
      className={`group z-20 touch-none select-none ${axis === "x" ? "cursor-col-resize" : "cursor-row-resize"}`}
      style={style}
    >
      <span className={lineClass} />
    </span>
  );
}
