"use client";
/* PROJECT-MAIL: поле получателей с чипами. */
import { useState } from "react";
import { isValidEmail } from "@/lib/mailRecipients";

interface Props { label: string; values: string[]; onChange: (values: string[]) => void; placeholder?: string; }

export default function RecipientsInput({ label, values, onChange, placeholder }: Props) {
  const [draft, setDraft] = useState("");
  const commit = (raw: string) => {
    const parts = raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return;
    const next = [...values];
    for (const p of parts) if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next); setDraft("");
  };
  return (
    <div>
      <label className="mb-1 block text-xs text-white/50">{label}</label>
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-white/10 bg-black/20 p-1.5">
        {values.map((v, i) => {
          const ok = isValidEmail(v);
          return (
            <span key={v + i} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${ok ? "bg-white/10 text-white/85" : "bg-red-500/20 text-red-200"}`}>
              {v}
              <button type="button" className="text-white/50 hover:text-white" onClick={() => onChange(values.filter((_, j) => j !== i))}>×</button>
            </span>
          );
        })}
        <input
          className="min-w-[140px] flex-1 bg-transparent px-1 py-0.5 text-xs text-white/85 outline-none"
          value={draft} placeholder={placeholder || "адрес и Enter"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === ";") { e.preventDefault(); commit(draft); }
            else if (e.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1));
          }}
          onPaste={(e) => { const t = e.clipboardData.getData("text"); if (/[,;\s]/.test(t)) { e.preventDefault(); commit(t); } }}
          onBlur={() => draft && commit(draft)}
        />
      </div>
    </div>
  );
}
