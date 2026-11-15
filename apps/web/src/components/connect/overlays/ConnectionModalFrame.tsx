"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { XIcon } from "@/components/ui/ConnectIcons";

export type ConnectionTheme = "amnezia" | "reliable";
export type ConnectionStatusTone = "success" | "accent" | "muted" | "warning" | "danger";

export interface ConnectionPlanCardData {
  label: string;
  periodLabel: string;
  note?: string | null;
}

interface ConnectionModalFrameProps {
  theme: ConnectionTheme;
  eyebrow: string;
  title: string;
  subtitle: string;
  onClose: () => void;
  power: {
    onClick: () => void;
    disabled: boolean;
    pressed: boolean;
    transitional?: boolean;
    label: string;
    hint?: string;
  };
  status: {
    title?: string | null;
    description?: string | null;
    tone?: ConnectionStatusTone;
  };
  plan: ConnectionPlanCardData;
  notice?: ReactNode;
  children?: ReactNode;
}

const themeStyles = {
  amnezia: {
    glow: "bg-[radial-gradient(circle_at_50%_0%,rgba(99,102,241,.14),transparent_58%)]",
    focus: "focus-visible:ring-cyan-400/60",
    close: "hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-white/[0.07] dark:hover:text-white",
    powerIdle: "border-neutral-300 bg-neutral-100 text-neutral-500 shadow-inner dark:border-white/10 dark:bg-white/[0.06] dark:text-white/50",
    powerTransition: "border-cyan-400/50 bg-cyan-500/20 text-cyan-600 dark:text-cyan-300",
    ping: "border-cyan-400/50",
    planBorder: "border-neutral-200 dark:border-white/[0.07]",
  },
  reliable: {
    glow: "bg-[radial-gradient(circle_at_50%_0%,rgba(139,92,246,.18),transparent_62%)]",
    focus: "focus-visible:ring-violet-500 focus-visible:ring-offset-4 dark:focus-visible:ring-offset-[#111317]",
    close: "hover:bg-violet-500/10 hover:text-neutral-700 dark:hover:text-white",
    powerIdle: "border-violet-300 bg-violet-50 text-violet-600 shadow-inner dark:border-violet-400/20 dark:bg-violet-500/[0.08] dark:text-violet-200",
    powerTransition: "border-violet-400/60 bg-violet-500/15 text-violet-600 dark:text-violet-300",
    ping: "border-violet-400/50",
    planBorder: "border-violet-200/80 dark:border-white/[0.08]",
  },
} as const;

const statusToneStyles: Record<ConnectionStatusTone, string> = {
  success: "text-emerald-600 dark:text-emerald-400",
  accent: "text-violet-600 dark:text-violet-300",
  muted: "text-neutral-600 dark:text-white/65",
  warning: "text-amber-700 dark:text-amber-300",
  danger: "text-red-600 dark:text-red-400",
};

/**
 * Shared shell for the two project VPN providers. Geometry, header, power
 * control, status area and plan card are deliberately identical; only copy,
 * theme and provider-specific content differ.
 */
export default function ConnectionModalFrame({
  theme,
  eyebrow,
  title,
  subtitle,
  onClose,
  power,
  status,
  plan,
  notice,
  children,
}: ConnectionModalFrameProps) {
  const styles = themeStyles[theme];
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, []);

  return (
    <div
      ref={dialogRef}
      className="relative h-full min-h-full overflow-y-auto p-6 text-neutral-900 dark:text-white"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connection-modal-title"
      tabIndex={-1}
    >
      <div className={`pointer-events-none absolute inset-0 opacity-70 ${styles.glow}`} />
      <div className="relative flex min-h-full flex-col">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-neutral-400 dark:text-white/40">
              {eyebrow}
            </p>
            <h3 id="connection-modal-title" className="mt-1 text-xl font-semibold">
              {title}
            </h3>
            <p className="mt-1 text-xs text-neutral-500 dark:text-white/45">
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-xl p-2 text-neutral-400 transition-colors ${styles.close} focus-visible:outline-none focus-visible:ring-2 ${styles.focus}`}
            aria-label="Закрыть"
          >
            <XIcon size={15} style={{ color: "inherit" }} />
          </button>
        </div>

        <div className="mt-7 flex flex-col items-center">
          <button
            type="button"
            onClick={power.onClick}
            disabled={power.disabled}
            aria-pressed={power.pressed}
            aria-label={power.label}
            title={power.hint ?? power.label}
            className={`relative grid h-28 w-28 place-items-center rounded-full border outline-none transition-all duration-300 ${styles.focus} ${
              power.disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:scale-[1.03] active:scale-95"
            } ${
              power.pressed
                ? "border-emerald-400/50 bg-emerald-500 text-white shadow-[0_0_45px_rgba(34,197,94,.30)]"
                : power.transitional
                  ? styles.powerTransition
                  : styles.powerIdle
            }`}
          >
            <span className={`absolute inset-2 rounded-full border ${power.pressed ? "border-white/20" : "border-neutral-200 dark:border-white/[0.06]"}`} />
            {power.transitional && <span className={`absolute inset-0 animate-ping rounded-full border ${styles.ping}`} />}
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M12 2v10" />
              <path d="M6.35 5.35a8 8 0 1 0 11.3 0" />
            </svg>
          </button>
          {status.title ? (
            <strong className={`mt-4 text-center text-sm ${status.tone === "accent" && theme === "amnezia" ? "text-cyan-600 dark:text-cyan-300" : statusToneStyles[status.tone ?? "muted"]}`} aria-live="polite">
              {status.title}
            </strong>
          ) : (
            <span className="mt-4 text-sm text-neutral-500 dark:text-white/50" aria-live="polite">Проверяем состояние…</span>
          )}
          {status.description ? (
            <span className="mt-1 max-w-xs text-center text-[11px] leading-relaxed text-neutral-400 dark:text-white/40">
              {status.description}
            </span>
          ) : null}
        </div>

        {notice}

        <div className={`mt-6 rounded-2xl border bg-neutral-50 p-4 ${styles.planBorder} dark:bg-white/[0.035]`}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-white/30">Тариф</span>
            <span className="text-[11px] text-neutral-400 dark:text-white/35">{plan.periodLabel}</span>
          </div>
          <strong className="mt-1 block text-sm">{plan.label}</strong>
          {plan.note ? (
            <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-white/40">{plan.note}</p>
          ) : null}
        </div>

        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
