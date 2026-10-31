"use client";

import { useId, useRef, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { QuestionIcon } from "@/components/ui/ConnectIcons";

/** Viewport-clamped tooltip. A hidden absolute box must not widen the document. */
export default function InfoTooltip({ text, side = "top", className = "" }: {
  text: string; side?: "top" | "bottom"; className?: string;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 8, top: 8, below: true });
  const position = useCallback(() => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(288, window.innerWidth - 16);
    const below = side === "bottom" || r.top < 130;
    setPos({ left: Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8)), top: below ? r.bottom + 8 : r.top - 8, below });
  }, [side]);
  useEffect(() => {
    if (!open) return;
    position();
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } };
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    document.addEventListener("keydown", close, true);
    return () => { window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); document.removeEventListener("keydown", close, true); };
  }, [open, position]);
  return (
    <span className={`inline-flex shrink-0 align-middle ${className}`} onMouseEnter={() => { position(); setOpen(true); }} onMouseLeave={() => setOpen(false)}>
      <button ref={button} type="button" aria-describedby={open ? id : undefined} aria-label="Подробнее" aria-expanded={open}
        onFocus={() => { position(); setOpen(true); }} onBlur={() => setOpen(false)}
        onClick={(event) => { event.preventDefault(); position(); setOpen(true); }}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-neutral-600 dark:text-gray-300 hover:text-violet-700 dark:hover:text-cyan-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 cursor-help">
        <QuestionIcon size={14} />
      </button>
      {open && createPortal(<span id={id} role="tooltip" style={{ position: "fixed", left: pos.left, top: pos.top, transform: pos.below ? undefined : "translateY(-100%)", width: "min(288px, calc(100vw - 16px))", maxHeight: "40vh", overflowY: "auto" }} className="z-[100] rounded-lg bg-neutral-900 px-3 py-2 text-xs font-normal leading-snug text-white shadow-lg ring-1 ring-white/20">{text}</span>, document.body)}
    </span>
  );
}
