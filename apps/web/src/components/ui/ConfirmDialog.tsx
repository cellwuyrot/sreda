"use client";

/**
 * App-styled replacement for the browser's native `confirm()` / `alert()`.
 *
 * The native dialogs render as raw OS chrome (grey Win32 boxes in the Electron
 * desktop build), which looks out of place next to the rest of the product.
 * This module provides a small imperative API — `confirmDialog()` /
 * `alertDialog()` — that shows a themed modal instead and resolves a Promise,
 * so call sites only change from:
 *
 *     if (!confirm("Удалить?")) return;
 * to:
 *     if (!(await confirmDialog("Удалить?"))) return;
 *
 * A single <ConfirmDialogHost/> (mounted once in Providers) owns the rendering;
 * the imperative functions talk to it through a module-level listener. If the
 * host is not mounted yet (SSR or a stray early call) we fall back to the
 * native dialog so behaviour is never lost.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** Render the confirm button in a destructive (red) style. */
  danger?: boolean;
}

type DialogKind = "confirm" | "alert";

interface DialogRequest {
  id: number;
  kind: DialogKind;
  opts: ConfirmOptions;
  resolve: (value: boolean) => void;
}

let hostListener: ((req: DialogRequest) => void) | null = null;
let counter = 0;

function normalize(opts: string | ConfirmOptions): ConfirmOptions {
  return typeof opts === "string" ? { message: opts } : opts;
}

function enqueue(kind: DialogKind, raw: string | ConfirmOptions): Promise<boolean> {
  const opts = normalize(raw);
  return new Promise((resolve) => {
    if (!hostListener) {
      // Host not mounted (SSR / very early call) — degrade gracefully.
      if (typeof window === "undefined") {
        resolve(kind === "alert");
        return;
      }
      if (kind === "confirm") resolve(window.confirm(opts.message));
      else {
        window.alert(opts.message);
        resolve(true);
      }
      return;
    }
    hostListener({ id: ++counter, kind, opts, resolve });
  });
}

/** Show a themed confirmation dialog. Resolves `true` on confirm. */
export function confirmDialog(opts: string | ConfirmOptions): Promise<boolean> {
  return enqueue("confirm", opts);
}

/** Show a themed alert dialog. Resolves once dismissed. */
export function alertDialog(opts: string | ConfirmOptions): Promise<void> {
  return enqueue("alert", opts).then(() => undefined);
}

export function ConfirmDialogHost() {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const current = queue[0] ?? null;

  useEffect(() => {
    hostListener = (req) => setQueue((q) => [...q, req]);
    return () => {
      hostListener = null;
    };
  }, []);

  const settle = useCallback((result: boolean) => {
    setQueue((q) => {
      const [head, ...rest] = q;
      head?.resolve(result);
      return rest;
    });
  }, []);

  useEffect(() => {
    if (!current) return;
    // Focus the primary action for keyboard users.
    const t = requestAnimationFrame(() => confirmBtnRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        settle(current.kind === "alert");
      } else if (e.key === "Enter") {
        e.preventDefault();
        settle(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [current, settle]);

  if (!current) return null;

  const { opts, kind } = current;
  const confirmText = opts.confirmText ?? (kind === "alert" ? "Понятно" : "ОК");
  const cancelText = opts.cancelText ?? "Отмена";

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={opts.title ?? opts.message}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={() => settle(kind === "alert")}
      />
      {/* Card */}
      <div
        className="relative w-full max-w-sm rounded-2xl border shadow-2xl p-5 animate-scale-in"
        style={{ background: "var(--cn-sidebar)", borderColor: "var(--cn-border)", color: "var(--cn-text)" }}
      >
        {opts.title && (
          <h2 className="text-base font-semibold mb-1.5" style={{ color: "var(--cn-text)" }}>
            {opts.title}
          </h2>
        )}
        <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "var(--cn-muted)" }}>
          {opts.message}
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          {kind === "confirm" && (
            <button
              type="button"
              onClick={() => settle(false)}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-[var(--cn-hover)]"
              style={{ border: "1px solid var(--cn-border)", color: "var(--cn-text)" }}
            >
              {cancelText}
            </button>
          )}
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={() => settle(true)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-0 ${
              opts.danger ? "bg-red-500 focus:ring-red-400/40" : "bg-violet-500 dark:bg-cyan-600 focus:ring-violet-400/40 dark:focus:ring-cyan-400/40"
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
