"use client";
import React, { useState } from "react";
import { isValidEmail } from "@/lib/mailRecipients";

export function RecipientsInput({ label, values, onChange }: { label: string; values: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState("");

  const add = (raw: string) => {
    const parts = raw.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return;
    const next = [...values];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    onChange(next);
    setText("");
  };

  const remove = (email: string) => onChange(values.filter((v) => v !== email));

  return (
    <div className="mb-3">
      <label className="mb-1.5 block text-xs font-medium text-neutral-600 dark:text-gray-300">{label}</label>
      <div className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 transition focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-500/10 dark:border-white/10 dark:bg-neutral-950/50 dark:focus-within:border-cyan-400/60 dark:focus-within:ring-cyan-400/10">
        {values.map((v) => (
          <span
            key={v}
            className={`inline-flex max-w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
              isValidEmail(v)
                ? "bg-violet-50 text-violet-700 dark:bg-cyan-500/10 dark:text-cyan-300"
                : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
            }`}
          >
            <span className="truncate">{v}</span>
            <button type="button" onClick={() => remove(v)} className="shrink-0 rounded px-0.5 text-current/60 hover:text-current" aria-label={`Удалить ${v}`}>
              ×
            </button>
          </span>
        ))}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(text);
            } else if (e.key === "Backspace" && !text && values.length) {
              remove(values[values.length - 1]);
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            add(e.clipboardData.getData("text"));
          }}
          onBlur={() => add(text)}
          placeholder="email@example.com"
          className="min-w-[180px] flex-1 bg-transparent px-1 py-1 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-white dark:placeholder:text-gray-500"
          aria-label={label}
        />
      </div>
    </div>
  );
}

export default RecipientsInput;
