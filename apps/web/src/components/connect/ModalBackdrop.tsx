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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && contentRef.current) {
        const focusable = contentRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
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
    contentRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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
