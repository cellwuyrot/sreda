"use client";

import { useEffect, useRef } from "react";
const stack: symbol[] = [];

/** Shared keyboard lifecycle for both standard and full-screen dialogs. */
export function useModalFocus(onClose: () => void, enabled = true, instance?: string | number) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!enabled || !ref.current) return;
    const token = Symbol("dialog"); stack.push(token);
    const previous = document.activeElement as HTMLElement | null;
    const controls = () => Array.from(ref.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), iframe, [tabindex]:not([tabindex="-1"])'
    ) ?? []).filter(el => !el.closest("[hidden]") && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden");
    const onKey = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== token || !ref.current) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== "Tab") return;
      const list = controls(), first = list[0], last = list[list.length - 1];
      if (!first) { event.preventDefault(); ref.current.focus(); }
      else if (!ref.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    if (!ref.current.contains(document.activeElement)) (controls()[0] ?? ref.current).focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      const wasTop = stack[stack.length - 1] === token;
      const index = stack.indexOf(token); if (index >= 0) stack.splice(index, 1);
      if (wasTop && previous?.isConnected) previous.focus();
    };
  }, [enabled, instance]);
  return ref;
}
