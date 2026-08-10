"use client";

import { useEffect, useRef, useCallback } from "react";
import { useInlineEdit } from "./InlineEditContext";

function getElementPath(el: HTMLElement): string {
  const parts: string[] = [];
  let cur: HTMLElement | null = el;
  while (cur && cur !== document.body) {
    const tag = cur.tagName.toLowerCase();
    const par: HTMLElement | null = cur.parentElement;
    if (par) {
      const curTag = cur.tagName;
      const siblings = Array.from(par.children).filter(
        (c) => c.tagName === curTag
      );
      const idx = siblings.indexOf(cur);
      parts.unshift(siblings.length > 1 ? `${tag}[${idx}]` : tag);
    } else {
      parts.unshift(tag);
    }
    cur = par;
  }
  return parts.join(">");
}

function isTextElement(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  const textTags = [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "span", "a", "li", "label", "button",
    "td", "th", "dt", "dd", "figcaption", "blockquote",
  ];

  if (!textTags.includes(tag)) return false;

  const hasDirectText = Array.from(el.childNodes).some(
    (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()
  );
  if (!hasDirectText) return false;

  if (el.closest("[data-no-edit]")) return false;
  if (el.closest("input, textarea, select, [contenteditable=true]")) return false;
  if (el.closest("nav") && el.tagName !== "A" && el.tagName !== "SPAN") return false;

  // Skip compound elements (have child elements with text — editing them causes duplication)
  const hasChildElementsWithText = Array.from(el.children).some(
    child => child.textContent?.trim()
  );
  if (hasChildElementsWithText) return false;

  const text = el.textContent?.trim() || "";
  if (text.length < 1 || text.length > 2000) return false;

  return true;
}

export default function InlineEditOverlay() {
  const { editMode, saveContent, contents } = useInlineEdit();
  const activeElRef = useRef<HTMLElement | null>(null);
  const originalTextRef = useRef<string>("");

  const applyOverrides = useCallback(() => {
    if (!contents || Object.keys(contents).length === 0) return;

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          const el = node as HTMLElement;
          if (isTextElement(el)) return NodeFilter.FILTER_ACCEPT;
          return NodeFilter.FILTER_SKIP;
        },
      }
    );

    let node: Node | null;
    while ((node = walker.nextNode())) {
      const el = node as HTMLElement;
      const path = getElementPath(el);
      if (contents[path] && el.getAttribute("data-original") !== null) {
        const textNode = Array.from(el.childNodes).find(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()
        );
        if (textNode && textNode.textContent?.trim() !== contents[path]) {
          textNode.textContent = contents[path];
        }
      }
    }
  }, [contents]);

  useEffect(() => {
    applyOverrides();
  }, [applyOverrides]);

  useEffect(() => {
    if (!editMode) {
      document.querySelectorAll("[data-inline-editable]").forEach((el) => {
        el.removeAttribute("data-inline-editable");
        (el as HTMLElement).style.removeProperty("cursor");
      });
      if (activeElRef.current) {
        activeElRef.current.contentEditable = "false";
        activeElRef.current.blur();
        activeElRef.current = null;
      }
      return;
    }

    const handleMouseOver = (e: Event) => {
      const target = e.target as HTMLElement;
      if (!isTextElement(target)) return;
      if (target === activeElRef.current) return;

      target.setAttribute("data-inline-editable", "true");
      target.style.cursor = "pointer";
    };

    const handleMouseOut = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target === activeElRef.current) return;
      target.removeAttribute("data-inline-editable");
      target.style.removeProperty("cursor");
    };

    const handleClick = (e: Event) => {
      const target = e.target as HTMLElement;
      if (!isTextElement(target)) return;
      if (target === activeElRef.current) return;

      e.preventDefault();
      e.stopPropagation();

      if (activeElRef.current) {
        commitEdit(activeElRef.current);
      }

      activeElRef.current = target;
      originalTextRef.current = target.textContent?.trim() || "";

      if (!target.getAttribute("data-original")) {
        target.setAttribute("data-original", originalTextRef.current);
      }

      target.contentEditable = "true";
      target.focus();

      target.setAttribute("data-inline-editing", "true");

      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(target);
      selection?.removeAllRanges();
      selection?.addRange(range);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!activeElRef.current) return;

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        commitEdit(activeElRef.current);
        activeElRef.current.blur();
        activeElRef.current = null;
      }
      if (e.key === "Escape" && activeElRef.current) {
        activeElRef.current.textContent = originalTextRef.current;
        activeElRef.current.contentEditable = "false";
        activeElRef.current.removeAttribute("data-inline-editing");
        activeElRef.current = null;
      }
    };

    const handleBlur = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target === activeElRef.current) {
        setTimeout(() => {
          if (activeElRef.current === target) {
            commitEdit(target);
            activeElRef.current = null;
          }
        }, 100);
      }
    };

    const commitEdit = (el: HTMLElement) => {
      const newText = el.textContent?.trim() || "";
      el.contentEditable = "false";
      el.removeAttribute("data-inline-editing");

      if (newText && newText !== originalTextRef.current) {
        const path = getElementPath(el);
        el.setAttribute("data-original", originalTextRef.current);
        saveContent(path, newText);
      }
    };

    document.addEventListener("mouseover", handleMouseOver, true);
    document.addEventListener("mouseout", handleMouseOut, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusout", handleBlur, true);

    return () => {
      document.removeEventListener("mouseover", handleMouseOver, true);
      document.removeEventListener("mouseout", handleMouseOut, true);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusout", handleBlur, true);
    };
  }, [editMode, saveContent]);

  if (!editMode) return null;

  return (
    <>
      <style jsx global>{`
        [data-inline-editable]:hover {
          outline: 2px dashed rgba(139, 92, 246, 0.5) !important;
          outline-offset: 2px;
          background: rgba(139, 92, 246, 0.05) !important;
          border-radius: 4px;
        }
        .dark [data-inline-editable]:hover {
          outline-color: rgba(0, 240, 255, 0.5) !important;
          background: rgba(0, 240, 255, 0.05) !important;
        }
        [data-inline-editing="true"] {
          outline: 2px solid rgba(139, 92, 246, 0.8) !important;
          outline-offset: 2px;
          background: rgba(139, 92, 246, 0.1) !important;
          border-radius: 4px;
          min-width: 20px;
          min-height: 1em;
        }
        .dark [data-inline-editing="true"] {
          outline-color: rgba(0, 240, 255, 0.8) !important;
          background: rgba(0, 240, 255, 0.1) !important;
        }
      `}</style>
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[95] px-4 py-2 rounded-xl bg-violet-500 dark:bg-cyan-500 text-white text-sm font-medium shadow-xl flex items-center gap-2 animate-pulse"
        data-no-edit
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        Режим редактирования — наведите на текст и кликните
      </div>
    </>
  );
}
