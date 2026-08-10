"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { useInlineEdit } from "./InlineEditContext";

interface EditableTextProps {
  contentKey: string;
  defaultValue: string;
  tag?: "h1" | "h2" | "h3" | "h4" | "p" | "span" | "div" | "li";
  className?: string;
  multiline?: boolean;
}

export default function EditableText({
  contentKey,
  defaultValue,
  tag: Tag = "span",
  className = "",
  multiline = false,
}: EditableTextProps) {
  const { editMode, saveContent, getContent } = useInlineEdit();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  const displayValue = getContent(contentKey) ?? defaultValue;

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEdit = () => {
    if (!editMode) return;
    setValue(displayValue);
    setEditing(true);
  };

  const commitEdit = () => {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== displayValue) {
      saveContent(contentKey, trimmed);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      commitEdit();
    }
    if (e.key === "Escape") {
      setEditing(false);
    }
  };

  if (editing) {
    const inputClassName = `bg-transparent border-2 border-violet-500 dark:border-cyan-400 rounded-lg px-1 outline-none w-full ${className}`;

    if (multiline) {
      return (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          className={`${inputClassName} resize-y min-h-[60px]`}
          rows={3}
        />
      );
    }

    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={handleKeyDown}
        className={inputClassName}
      />
    );
  }

  return (
    <Tag
      onClick={startEdit}
      className={`${className} ${
        editMode
          ? "cursor-pointer outline-2 outline-dashed outline-transparent hover:outline-violet-500/50 dark:hover:outline-cyan-400/50 hover:bg-violet-500/5 dark:hover:bg-cyan-400/5 rounded-lg transition-all duration-200 px-0.5 -mx-0.5"
          : ""
      }`}
      title={editMode ? "Нажмите для редактирования" : undefined}
    >
      {displayValue}
    </Tag>
  );
}
