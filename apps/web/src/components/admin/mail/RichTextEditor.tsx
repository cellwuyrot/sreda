"use client";
/* PROJECT-MAIL: простой Rich Text редактор (contentEditable + execCommand). */
import { useEffect, useRef } from "react";

export const FONT_SIZES = [13, 14, 16, 18, 22, 28];
export const COLORS = ["#1e1e28", "#7c3aed", "#2563eb", "#059669", "#dc2626", "#d97706", "#6b7280"];
const BTN = "h-7 min-w-7 rounded px-1.5 text-xs text-white/70 hover:bg-white/10";

export default function RichTextEditor({ html, onChange }: { html: string; onChange: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current && ref.current.innerHTML !== html) ref.current.innerHTML = html || ""; }, [html]);
  const exec = (cmd: string, value?: string) => { ref.current?.focus(); document.execCommand(cmd, false, value); if (ref.current) onChange(ref.current.innerHTML); };
  const setFontSize = (px: number) => {
    ref.current?.focus(); document.execCommand("fontSize", false, "7");
    const font = ref.current?.querySelectorAll('font[size="7"]');
    font?.forEach((el) => { (el as HTMLElement).removeAttribute("size"); (el as HTMLElement).style.fontSize = px + "px"; });
    if (ref.current) onChange(ref.current.innerHTML);
  };
  const insertLink = () => { const url = window.prompt("Адрес ссылки (https://…)"); if (url) exec("createLink", url); };
  const insertCta = () => {
    const url = window.prompt("Адрес кнопки (https://…)"); if (!url) return;
    const label = window.prompt("Текст кнопки", "Подробнее") || "Подробнее";
    exec("insertHTML", `<a href="${url}" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">${label}</a>&nbsp;`);
  };
  const insertCallout = () => exec("insertHTML", '<div style="background:#f3f0ff;border-left:3px solid #7c3aed;padding:10px 14px;border-radius:6px;margin:8px 0;">Важное сообщение</div>');
  return (
    <div className="rounded-lg border border-white/10 bg-black/20">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-white/10 p-1">
        <button type="button" className={BTN} onClick={() => exec("bold")}><b>B</b></button>
        <button type="button" className={BTN} onClick={() => exec("italic")}><i>I</i></button>
        <button type="button" className={BTN} onClick={() => exec("underline")}><u>U</u></button>
        <button type="button" className={BTN} onClick={() => exec("strikeThrough")}><s>S</s></button>
        <span className="mx-1 h-4 w-px bg-white/10" />
        <button type="button" className={BTN} onClick={() => exec("formatBlock", "H1")}>H1</button>
        <button type="button" className={BTN} onClick={() => exec("formatBlock", "H2")}>H2</button>
        <button type="button" className={BTN} onClick={() => exec("formatBlock", "H3")}>H3</button>
        <span className="mx-1 h-4 w-px bg-white/10" />
        <button type="button" className={BTN} onClick={() => exec("insertUnorderedList")}>• Список</button>
        <button type="button" className={BTN} onClick={() => exec("insertOrderedList")}>1. Список</button>
        <button type="button" className={BTN} onClick={() => exec("formatBlock", "BLOCKQUOTE")}>“ Цитата</button>
        <span className="mx-1 h-4 w-px bg-white/10" />
        <button type="button" className={BTN} onClick={insertLink}>Ссылка</button>
        <button type="button" className={BTN} onClick={() => exec("insertHorizontalRule")}>―</button>
        <button type="button" className={BTN} onClick={() => exec("justifyLeft")}>☰L</button>
        <button type="button" className={BTN} onClick={() => exec("justifyCenter")}>☰C</button>
        <button type="button" className={BTN} onClick={() => exec("justifyRight")}>☰R</button>
        <span className="mx-1 h-4 w-px bg-white/10" />
        <button type="button" className={BTN} onClick={insertCta}>CTA</button>
        <button type="button" className={BTN} onClick={insertCallout}>Блок</button>
        <button type="button" className={BTN} onClick={() => exec("undo")}>↶</button>
        <button type="button" className={BTN} onClick={() => exec("redo")}>↷</button>
        <span className="mx-1 h-4 w-px bg-white/10" />
        <select className="h-7 rounded bg-black/30 px-1 text-xs text-white/70" defaultValue="16" onChange={(e) => setFontSize(Number(e.target.value))}>
          {FONT_SIZES.map((s) => <option key={s} value={s}>{s}px</option>)}
        </select>
        <select className="h-7 rounded bg-black/30 px-1 text-xs text-white/70" defaultValue="" onChange={(e) => e.target.value && exec("foreColor", e.target.value)}>
          <option value="">Цвет</option>
          {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div ref={ref} contentEditable suppressContentEditableWarning
        className="min-h-[220px] max-h-[420px] overflow-auto px-3 py-2 text-sm text-white/90 outline-none"
        style={{ lineHeight: 1.55 }} onInput={() => ref.current && onChange(ref.current.innerHTML)} />
    </div>
  );
}
