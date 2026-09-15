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
    onChange(next); setText("");
  };
  const remove = (email: string) => onChange(values.filter((v) => v !== email));
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4, color: "#4b4b63" }}>{label}</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: 6, border: "1px solid #d7d7e0", borderRadius: 8, minHeight: 38 }}>
        {values.map((v) => (
          <span key={v} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 12, fontSize: 13, background: isValidEmail(v) ? "#eef2ff" : "#fee2e2", color: isValidEmail(v) ? "#3730a3" : "#b91c1c" }}>
            {v}
            <button type="button" onClick={() => remove(v)} style={{ border: "none", background: "none", cursor: "pointer", color: "inherit", fontSize: 14, lineHeight: 1 }}>\u00d7</button>
          </span>
        ))}
        <input value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(text); } else if (e.key === "Backspace" && !text && values.length) remove(values[values.length - 1]); }}
          onPaste={(e) => { e.preventDefault(); add(e.clipboardData.getData("text")); }}
          onBlur={() => add(text)} placeholder="email@example.com"
          style={{ flex: 1, minWidth: 160, border: "none", outline: "none", fontSize: 14, padding: "2px 4px" }} />
      </div>
    </div>
  );
}
export default RecipientsInput;
