"use client";
import { useId, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
/** Portal + viewport clamping: hidden help must not create horizontal scroll. */
export default function AdminHelp({
  text,
  className = "",
}: {
  text: string;
  side?: "top" | "bottom";
  className?: string;
}) {
  const id = useId(),
    ref = useRef<HTMLButtonElement>(null),
    [open, setOpen] = useState(false);
  const [pos, setPos] = useState({
    left: 12,
    top: 12,
    above: false,
    width: 280,
  });
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const box = ref.current?.getBoundingClientRect();
      if (!box) return;
      const width = Math.min(280, window.innerWidth - 24);
      const above = box.top > 160;
      setPos({
        left: Math.max(
          12,
          Math.min(box.left - width / 2, window.innerWidth - width - 12),
        ),
        top: above ? box.top - 8 : box.bottom + 8,
        above,
        width,
      });
    };
    place();
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <span
      className={`inline-flex align-middle ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={ref}
        type="button"
        aria-label="Подробнее"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        className="admin-help-button"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        ?
      </button>
      {open &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className="admin-help-popover"
            style={{
              left: pos.left,
              top: pos.top,
              width: pos.width,
              transform: pos.above ? "translateY(-100%)" : undefined,
            }}
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
