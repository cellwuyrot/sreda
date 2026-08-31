"use client";
import { useEffect } from "react";

export type CmdResultData = {
  status: "success" | "error" | "info";
  title?: string;
  lines: string[];
  /** ms before auto-dismiss (default 8000, 0 = sticky) */
  autoDismissMs?: number;
};

const STATUS_STYLE: Record<CmdResultData["status"], string> = {
  success: "bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700 text-green-800 dark:text-green-300",
  error:   "bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300",
  info:    "bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-white/10 text-neutral-700 dark:text-neutral-200",
};

const STATUS_ICON: Record<CmdResultData["status"], string> = {
  success: "✔",
  error: "✖",
  info: "ℹ",
};

interface Props {
  result: CmdResultData;
  onDismiss: () => void;
}

export default function SlashCommandResult({ result, onDismiss }: Props) {
  const ms = result.autoDismissMs ?? 8000;
  useEffect(() => {
    if (ms <= 0) return;
    const t = setTimeout(onDismiss, ms);
    return () => clearTimeout(t);
  }, [result, ms, onDismiss]);

  return (
    <div
      className={`absolute bottom-full left-2 right-2 mb-2 rounded-xl border px-3 py-2.5 shadow-lg z-40 animate-fade-in ${
        STATUS_STYLE[result.status]
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-sm font-semibold flex-shrink-0">{STATUS_ICON[result.status]}</span>
        <div className="flex-1 min-w-0">
          {result.title && (
            <p className="text-xs font-semibold mb-0.5">{result.title}</p>
          )}
          {result.lines.map((line, i) => (
            <p key={i} className="text-xs leading-relaxed">{line}</p>
          ))}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="flex-shrink-0 opacity-60 hover:opacity-100 ml-1 text-sm leading-none"
          aria-label="Закрыть"
        >
          ×
        </button>
      </div>
    </div>
  );
}
