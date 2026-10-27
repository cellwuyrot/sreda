"use client";

import { motion } from "framer-motion";
import { useEffect, useRef } from "react";

interface ModalBackdropProps {
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}

export default function ModalBackdrop({ onClose, children, maxWidth = "max-w-sm" }: ModalBackdropProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // A parent often passes an inline onClose. Updating it must not refocus
  // the dialog on every keystroke.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
      if (e.key === "Tab" && contentRef.current) {
        const focusable = contentRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    const content = contentRef.current;
    // React's autoFocus has already run. Never steal focus from that field.
    if (content && !content.contains(document.activeElement)) {
      content.querySelector<HTMLElement>("input:not(:disabled), textarea:not(:disabled), button:not(:disabled)")?.focus();
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center max-md:items-end max-md:p-0 p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <motion.div
        ref={contentRef}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className={`bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-white/10 p-6 ${maxWidth} w-full shadow-2xl
          max-md:max-w-none max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0 max-md:max-h-[92dvh] max-md:overflow-y-auto max-md:p-5 max-md:pb-[max(1.25rem,env(safe-area-inset-bottom))]`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
