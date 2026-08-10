"use client";

import { useEffect, useRef, useState } from "react";
import { Priority, PRIORITY_META } from "./types";
import { ChevronDownIcon, CloseIcon, PlusIcon } from "./icons";

/* ── Shared monochrome class tokens ─────────────────────────────────────── */

export const FIELD_BASE =
  "rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-950/40 " +
  "focus-within:border-neutral-400 dark:focus-within:border-neutral-500 transition-colors";

export const INPUT_BASE =
  "bg-transparent text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 " +
  "dark:placeholder-neutral-600 focus:outline-none";

/* ── Priority pill (grayscale shades, no color) ─────────────────────────── */

export function priorityPillClass(p: Priority): string {
  switch (p) {
    case "p1":
      return "bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 ring-1 ring-neutral-900 dark:ring-white";
    case "p2":
      return "bg-neutral-500 text-white dark:bg-neutral-300 dark:text-neutral-950";
    case "p3":
      return "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-100";
    case "p4":
    default:
      return "bg-transparent text-neutral-500 dark:text-neutral-400 ring-1 ring-inset ring-neutral-300 dark:ring-neutral-700";
  }
}

export function PriorityPill({ p, className = "" }: { p: Priority; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tracking-wide ${priorityPillClass(
        p,
      )} ${className}`}
      title={`Приоритет: ${PRIORITY_META[p].label}`}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-[1px]"
        style={{ background: "currentColor", opacity: p === "p4" ? 0.6 : 1 }}
      />
      {PRIORITY_META[p].short}
    </span>
  );
}

/* ── Toolbar block wrapper ──────────────────────────────────────────────── */

/**
 * A visual "block" on the control panel: a rounded, bordered container that
 * groups related controls together so the toolbar reads as a handful of
 * discrete modules instead of one long, overloaded strip.
 */
export function ToolGroup({
  label,
  children,
  className = "",
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-1 rounded-xl border border-neutral-200 bg-white/70 p-1
        dark:border-neutral-800 dark:bg-neutral-900/60 ${className}`}
    >
      {label && (
        <span className="pl-1.5 pr-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
          {label}
        </span>
      )}
      {children}
    </div>
  );
}

/* ── Action dropdown menu ───────────────────────────────────────────────── */

export type MenuAction = {
  label: string;
  icon?: React.ReactNode;
  hint?: string;
  onClick: () => void;
};

export type MenuItem = MenuAction | "separator";

/**
 * A button that opens a small popover list of actions. Used to collapse many
 * single-purpose toolbar buttons (add task/note/document/link/image…) into one
 * tidy entry point.
 */
export function ToolMenu({
  label,
  icon,
  items,
  align = "right",
  primary = false,
  title,
}: {
  label: string;
  icon?: React.ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  primary?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const btnClass = primary
    ? "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-700 dark:border-white dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
    : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-neutral-600";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={title}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${btnClass}`}
      >
        {icon}
        <span>{label}</span>
        <ChevronDownIcon size={12} className="opacity-60" />
      </button>
      {open && (
        <div
          className={`absolute z-40 mt-1 min-w-[12rem] overflow-hidden rounded-xl border border-neutral-200
            bg-white py-1 shadow-xl shadow-black/10 dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-black/40 ${
              align === "right" ? "right-0" : "left-0"
            }`}
        >
          {items.map((item, i) =>
            item === "separator" ? (
              <div key={`sep-${i}`} className="my-1 h-px bg-neutral-100 dark:bg-neutral-800" />
            ) : (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-neutral-700
                  transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                {item.icon && <span className="text-neutral-400 dark:text-neutral-500">{item.icon}</span>}
                <span className="flex-1">{item.label}</span>
                {item.hint && (
                  <span className="text-[10px] text-neutral-400 dark:text-neutral-500">{item.hint}</span>
                )}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/* ── Generic dropdown picker ────────────────────────────────────────────── */

export function Picker<T extends string>({
  value,
  options,
  onChange,
  label,
  className = "",
}: {
  value: T;
  options: { value: T; label: string; hint?: React.ReactNode }[];
  onChange: (v: T) => void;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800
          bg-white dark:bg-neutral-900 px-2.5 py-1.5 text-xs font-medium
          text-neutral-700 dark:text-neutral-200 hover:border-neutral-400 dark:hover:border-neutral-600 transition-colors"
      >
        {label && <span className="text-neutral-400 dark:text-neutral-500">{label}</span>}
        <span>{current?.label ?? value}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-neutral-400">
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute right-0 z-30 mt-1 min-w-[10rem] overflow-hidden rounded-xl border
            border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl shadow-black/10 dark:shadow-black/40"
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs
                hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors ${
                  o.value === value
                    ? "text-neutral-900 dark:text-white font-semibold"
                    : "text-neutral-600 dark:text-neutral-300"
                }`}
            >
              <span className="flex items-center gap-2">{o.hint}{o.label}</span>
              {o.value === value && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <path d="m5 12 5 5 9-11" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Monochrome progress bar ────────────────────────────────────────────── */

export function ProgressBar({ value, editable, onChange }: { value: number; editable?: boolean; onChange?: (v: number) => void }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-neutral-900 dark:bg-white transition-[width] duration-300"
          style={{ width: `${v}%` }}
        />
        {editable && onChange && (
          <input
            type="range"
            min={0}
            max={100}
            value={v}
            onChange={(e) => onChange(Number(e.target.value))}
            className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
            aria-label="Прогресс выполнения"
          />
        )}
      </div>
      <span className="w-8 text-right text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">{v}%</span>
    </div>
  );
}

/* ── Tag editor (monochrome chips) ──────────────────────────────────────── */

export function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim().replace(/^#/, "");
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <span
          key={t}
          className="group inline-flex items-center gap-1 rounded-md bg-neutral-100 dark:bg-neutral-800
            px-1.5 py-0.5 text-[11px] text-neutral-600 dark:text-neutral-300"
        >
          #{t}
          <button
            type="button"
            onClick={() => onChange(tags.filter((x) => x !== t))}
            className="text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
            aria-label={`Убрать тег ${t}`}
          >
            <CloseIcon size={11} />
          </button>
        </span>
      ))}
      <span className={`inline-flex items-center gap-1 px-1 ${tags.length ? "" : ""}`}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="тег"
          className={`w-16 ${INPUT_BASE} text-[11px]`}
        />
        {draft && (
          <button type="button" onClick={add} className="text-neutral-400 hover:text-neutral-900 dark:hover:text-white">
            <PlusIcon size={12} />
          </button>
        )}
      </span>
    </div>
  );
}

/* ── Auto-growing textarea ──────────────────────────────────────────────── */

export function AutoTextarea({
  value,
  onChange,
  placeholder,
  className = "",
  minRows = 2,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  minRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`resize-none ${INPUT_BASE} ${className}`}
    />
  );
}
