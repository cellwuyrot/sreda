"use client";

import { motion } from "framer-motion";
import { useModalFocus } from "@/hooks/useModalFocus";

interface ModalBackdropProps {
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
  labelledBy?: string;
  ariaLabel?: string;
  mobileFullScreen?: boolean;
}

export default function ModalBackdrop({ onClose, children, maxWidth = "max-w-sm", labelledBy, ariaLabel, mobileFullScreen = false }: ModalBackdropProps) {
  const contentRef = useModalFocus(onClose);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={`fixed inset-0 z-50 flex items-center justify-center max-md:p-0 p-4 bg-black/60 backdrop-blur-sm ${mobileFullScreen ? "max-md:items-stretch" : "max-md:items-end"}`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-label={ariaLabel}
    >
      <motion.div
        ref={contentRef}
        tabIndex={-1}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className={`bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-white/10 p-6 ${maxWidth} w-full shadow-2xl
          max-md:max-w-none max-md:overflow-y-auto max-md:p-5 max-md:pb-[max(1.25rem,env(safe-area-inset-bottom))] ${mobileFullScreen
            ? "max-md:flex max-md:flex-col max-md:h-[var(--tz-app-h,100dvh)] max-md:max-h-none max-md:rounded-none max-md:border-0 max-md:pt-[max(1.25rem,env(safe-area-inset-top))]"
            : "max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0 max-md:max-h-[92dvh]"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
