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
      className="inline-flex h-8 items-center justify-center rounded-md border border-neutral-200 bg-white px-2.5 text-xs font-medium text-neutral-700 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:border-cyan-400/40 dark:hover:bg-cyan-500/10 dark:hover:text-cyan-300"
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
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-white/10 dark:bg-neutral-950/40">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-neutral-200 bg-neutral-50 p-2 dark:border-white/10 dark:bg-white/[0.025]">
        <ToolbarButton label="B" title="Жирный" onAction={() => execCommand("bold")} />
        <ToolbarButton label="I" title="Курсив" onAction={() => execCommand("italic")} />
        <ToolbarButton label="U" title="Подчёркнутый" onAction={() => execCommand("underline")} />
        <ToolbarButton label="S" title="Зачёркнутый" onAction={() => execCommand("strikeThrough")} />
        <ToolbarButton label="H1" onAction={() => execCommand("formatBlock", "<h1>")} />
        <ToolbarButton label="H2" onAction={() => execCommand("formatBlock", "<h2>")} />
        <ToolbarButton label="H3" onAction={() => execCommand("formatBlock", "<h3>")} />
        <ToolbarButton label="• Список" onAction={() => execCommand("insertUnorderedList")} />
        <ToolbarButton label="1. Список" onAction={() => execCommand("insertOrderedList")} />
        <ToolbarButton label="❝" title="Цитата" onAction={() => execCommand("formatBlock", "<blockquote>")} />
        <ToolbarButton label="Ссылка" onAction={insertLink} />
        <ToolbarButton label="—" title="Разделитель" onAction={() => execCommand("insertHorizontalRule")} />
        <ToolbarButton label="←" title="По левому краю" onAction={() => execCommand("justifyLeft")} />
        <ToolbarButton label="≡" title="По центру" onAction={() => execCommand("justifyCenter")} />
        <ToolbarButton label="→" title="По правому краю" onAction={() => execCommand("justifyRight")} />
        <ToolbarButton label="↶" title="Отменить" onAction={() => execCommand("undo")} />
        <ToolbarButton label="↷" title="Повторить" onAction={() => execCommand("redo")} />
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
          className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-xs text-neutral-700 outline-none focus:border-violet-400 dark:border-white/10 dark:bg-neutral-950 dark:text-gray-300 dark:focus:border-cyan-400/60"
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
          className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-xs text-neutral-700 outline-none focus:border-violet-400 dark:border-white/10 dark:bg-neutral-950 dark:text-gray-300 dark:focus:border-cyan-400/60"
        >
          <option value="">Цвет</option>
          {COLORS.map((color) => <option key={color} value={color}>{color}</option>)}
        </select>
      </div>
      <div
        ref={ref}
        contentEditable
        onInput={emit}
        suppressContentEditableWarning
        className="min-h-[280px] bg-white px-4 py-3 text-[15px] leading-6 text-neutral-900 outline-none dark:bg-neutral-950/20 dark:text-gray-100"
        style={{ fontFamily: "Arial, Helvetica, system-ui, sans-serif" }}
      />
    </div>
  );
}

export default RichTextEditor;
