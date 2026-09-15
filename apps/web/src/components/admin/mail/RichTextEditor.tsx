"use client";
import React, { useRef, useEffect } from "react";

const FONT_SIZES = [13, 14, 16, 18, 22, 28];
const COLORS = ["#1a1a2e", "#7c3aed", "#e11d48", "#0ea5e9", "#16a34a", "#f59e0b", "#6b7280"];

export function RichTextEditor({ html, onChange }: { html: string; onChange: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current && ref.current.innerHTML !== html) ref.current.innerHTML = html || ""; }, []);
  const emit = () => { if (ref.current) onChange(ref.current.innerHTML); };
  const cmd = (c: string, v?: string) => { document.execCommand(c, false, v); ref.current?.focus(); emit(); };
  const setFontSize = (px: number) => {
    document.execCommand("fontSize", false, "7");
    ref.current?.querySelectorAll('font[size="7"]').forEach((el) => { el.removeAttribute("size"); (el as HTMLElement).style.fontSize = px + "px"; });
    emit();
  };
  const insertLink = () => { const url = prompt("URL \u0441\u0441\u044b\u043b\u043a\u0438:"); if (url) cmd("createLink", url); };
  const insertImage = () => { const url = prompt("URL \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f:"); if (url) cmd("insertImage", url); };
  const insertCTA = () => {
    const label = prompt("\u0422\u0435\u043a\u0441\u0442 \u043a\u043d\u043e\u043f\u043a\u0438:", "\u041e\u0442\u043a\u0440\u044b\u0442\u044c"); if (!label) return;
    const url = prompt("\u0421\u0441\u044b\u043b\u043a\u0430 \u043a\u043d\u043e\u043f\u043a\u0438:", "https://trioz.ru") || "#";
    document.execCommand("insertHTML", false, `<a href="${url}" style="display:inline-block;padding:10px 20px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">${label}</a>&nbsp;`);
    emit();
  };
  const insertCallout = () => { document.execCommand("insertHTML", false, `<div style="padding:12px 16px;background:#f3f0ff;border-left:4px solid #7c3aed;border-radius:6px;margin:8px 0;">\u0412\u044b\u0434\u0435\u043b\u0435\u043d\u043d\u044b\u0439 \u0431\u043b\u043e\u043a</div><p></p>`); emit(); };
  const btn = (label: string, action: () => void, title?: string) => (
    <button type="button" title={title || label} onMouseDown={(e) => { e.preventDefault(); action(); }} style={{ padding: "4px 8px", border: "1px solid #d7d7e0", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 13 }}>{label}</button>
  );
  return (
    <div style={{ border: "1px solid #d7d7e0", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: 6, borderBottom: "1px solid #eee", background: "#fafafc" }}>
        {btn("B", () => cmd("bold"))}{btn("I", () => cmd("italic"))}{btn("U", () => cmd("underline"))}{btn("S", () => cmd("strikeThrough"))}
        {btn("H1", () => cmd("formatBlock", "<h1>"))}{btn("H2", () => cmd("formatBlock", "<h2>"))}{btn("H3", () => cmd("formatBlock", "<h3>"))}
        {btn("\u2022 \u0421\u043f\u0438\u0441\u043e\u043a", () => cmd("insertUnorderedList"))}{btn("1. \u0421\u043f\u0438\u0441\u043e\u043a", () => cmd("insertOrderedList"))}
        {btn("\u275d", () => cmd("formatBlock", "<blockquote>"))}{btn("\u0421\u0441\u044b\u043b\u043a\u0430", insertLink)}{btn("\u2014", () => cmd("insertHorizontalRule"))}
        {btn("\u2190", () => cmd("justifyLeft"))}{btn("\u2261", () => cmd("justifyCenter"))}{btn("\u2192", () => cmd("justifyRight"))}
        {btn("\u21b6", () => cmd("undo"))}{btn("\u21b7", () => cmd("redo"))}
        {btn("\u041a\u0430\u0440\u0442\u0438\u043d\u043a\u0430", insertImage)}{btn("CTA", insertCTA)}{btn("\u0411\u043b\u043e\u043a", insertCallout)}
        <select onChange={(e) => { setFontSize(Number(e.target.value)); e.currentTarget.selectedIndex = 0; }} style={{ border: "1px solid #d7d7e0", borderRadius: 6, fontSize: 13 }}>
          <option>\u0420\u0430\u0437\u043c\u0435\u0440</option>{FONT_SIZES.map((s) => <option key={s} value={s}>{s}px</option>)}
        </select>
        <select onChange={(e) => { cmd("foreColor", e.target.value); e.currentTarget.selectedIndex = 0; }} style={{ border: "1px solid #d7d7e0", borderRadius: 6, fontSize: 13 }}>
          <option>\u0426\u0432\u0435\u0442</option>{COLORS.map((c) => <option key={c} value={c} style={{ color: c }}>{c}</option>)}
        </select>
      </div>
      <div ref={ref} contentEditable onInput={emit} suppressContentEditableWarning style={{ minHeight: 240, padding: 16, fontFamily: "Arial, Helvetica, system-ui, sans-serif", fontSize: 16, lineHeight: 1.6, outline: "none" }} />
    </div>
  );
}
export default RichTextEditor;
