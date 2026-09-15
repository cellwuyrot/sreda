"use client";
import React, { useEffect, useRef } from "react";

const FONT_SIZES = [13, 14, 16, 18, 22, 28];
const COLORS = ["#1a1a2e", "#7c3aed", "#e11d48", "#0ea5e9", "#16a34a", "#f59e0b", "#6b7280"];

interface ToolbarButtonProps {
  label: string;
  title?: string;
  onAction: () => void;
}

function ToolbarButton({ label, title, onAction }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={title || label}
      onMouseDown={(event) => {
        event.preventDefault();
        onAction();
      }}
      style={{ padding: "4px 8px", border: "1px solid #d7d7e0", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 13 }}
    >
      {label}
    </button>
  );
}

export function RichTextEditor({ html, onChange }: { html: string; onChange: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== html) ref.current.innerHTML = html || "";
  }, [html]);

  const emit = () => {
    const editor = ref.current;
    if (editor) onChange(editor.innerHTML);
  };

  const execCommand = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    ref.current?.focus();
    emit();
  };

  const setFontSize = (px: number) => {
    document.execCommand("fontSize", false, "7");
    ref.current?.querySelectorAll('font[size="7"]').forEach((el) => {
      el.removeAttribute("size");
      (el as HTMLElement).style.fontSize = `${px}px`;
    });
    ref.current?.focus();
    emit();
  };

  const insertLink = () => {
    const url = window.prompt("URL ссылки:");
    if (url) execCommand("createLink", url);
  };

  const insertImage = () => {
    const url = window.prompt("URL изображения:");
    if (url) execCommand("insertImage", url);
  };

  const insertCTA = () => {
    const label = window.prompt("Текст кнопки:", "Открыть");
    if (!label) return;
    const url = window.prompt("Ссылка кнопки:", "https://trioz.ru") || "#";
    document.execCommand(
      "insertHTML",
      false,
      `<a href="${url}" style="display:inline-block;padding:10px 20px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">${label}</a>&nbsp;`,
    );
    emit();
  };

  const insertCallout = () => {
    document.execCommand(
      "insertHTML",
      false,
      `<div style="padding:12px 16px;background:#f3f0ff;border-left:4px solid #7c3aed;border-radius:6px;margin:8px 0;">Выделенный блок</div><p></p>`,
    );
    emit();
  };

  return (
    <div style={{ border: "1px solid #d7d7e0", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: 6, borderBottom: "1px solid #eee", background: "#fafafc" }}>
        <ToolbarButton label="B" onAction={() => execCommand("bold")} />
        <ToolbarButton label="I" onAction={() => execCommand("italic")} />
        <ToolbarButton label="U" onAction={() => execCommand("underline")} />
        <ToolbarButton label="S" onAction={() => execCommand("strikeThrough")} />
        <ToolbarButton label="H1" onAction={() => execCommand("formatBlock", "<h1>")} />
        <ToolbarButton label="H2" onAction={() => execCommand("formatBlock", "<h2>")} />
        <ToolbarButton label="H3" onAction={() => execCommand("formatBlock", "<h3>")} />
        <ToolbarButton label="• Список" onAction={() => execCommand("insertUnorderedList")} />
        <ToolbarButton label="1. Список" onAction={() => execCommand("insertOrderedList")} />
        <ToolbarButton label="❝" onAction={() => execCommand("formatBlock", "<blockquote>")} />
        <ToolbarButton label="Ссылка" onAction={insertLink} />
        <ToolbarButton label="—" onAction={() => execCommand("insertHorizontalRule")} />
        <ToolbarButton label="←" onAction={() => execCommand("justifyLeft")} />
        <ToolbarButton label="≡" onAction={() => execCommand("justifyCenter")} />
        <ToolbarButton label="→" onAction={() => execCommand("justifyRight")} />
        <ToolbarButton label="↶" onAction={() => execCommand("undo")} />
        <ToolbarButton label="↷" onAction={() => execCommand("redo")} />
        <ToolbarButton label="Картинка" onAction={insertImage} />
        <ToolbarButton label="CTA" onAction={insertCTA} />
        <ToolbarButton label="Блок" onAction={insertCallout} />
        <select
          aria-label="Размер шрифта"
          defaultValue=""
          onChange={(event) => {
            setFontSize(Number(event.currentTarget.value));
            event.currentTarget.value = "";
          }}
          style={{ border: "1px solid #d7d7e0", borderRadius: 6, fontSize: 13 }}
        >
          <option value="">Размер</option>
          {FONT_SIZES.map((size) => <option key={size} value={size}>{size}px</option>)}
        </select>
        <select
          aria-label="Цвет текста"
          defaultValue=""
          onChange={(event) => {
            execCommand("foreColor", event.currentTarget.value);
            event.currentTarget.value = "";
          }}
          style={{ border: "1px solid #d7d7e0", borderRadius: 6, fontSize: 13 }}
        >
          <option value="">Цвет</option>
          {COLORS.map((color) => <option key={color} value={color} style={{ color }}>{color}</option>)}
        </select>
      </div>
      <div
        ref={ref}
        contentEditable
        onInput={emit}
        suppressContentEditableWarning
        style={{ minHeight: 240, padding: 16, fontFamily: "Arial, Helvetica, system-ui, sans-serif", fontSize: 16, lineHeight: 1.6, outline: "none" }}
      />
    </div>
  );
}

export default RichTextEditor;
