"use client";

import { Component, ReactNode } from "react";

/**
 * Minimal error boundary for the heavy, third-party-powered editors (the PDF
 * viewer in particular). If rendering throws — a corrupt file, an unsupported
 * feature deep inside pdf.js — we show a friendly message and a retry instead
 * of letting the exception blank out the whole modal.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; fallback: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-neutral-600 dark:text-neutral-300">{this.props.fallback}</p>
          <p className="max-w-md text-xs text-neutral-400 dark:text-neutral-500">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-200 dark:hover:border-neutral-500"
          >
            Попробовать снова
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
