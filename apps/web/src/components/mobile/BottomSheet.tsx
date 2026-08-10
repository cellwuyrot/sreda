"use client";

import { useRef, useEffect } from "react";
import { motion, AnimatePresence, PanInfo } from "framer-motion";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Height as percentage string, e.g. "90%" or "70%" */
  height?: string;
  title?: string;
}

export default function BottomSheet({ open, onClose, children, height = "90%", title }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-50 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            ref={sheetRef}
            className="fixed bottom-0 left-0 right-0 z-50 flex flex-col
              bg-white dark:bg-neutral-900 rounded-t-2xl overflow-hidden"
            style={{ height, maxHeight: "95vh" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={0.1}
            onDragEnd={handleDragEnd}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0 cursor-grab active:cursor-grabbing">
              <div className="w-10 h-1 rounded-full bg-neutral-300 dark:bg-neutral-600" />
            </div>

            {title && (
              <div className="px-4 pb-2 border-b border-neutral-200 dark:border-white/5 flex-shrink-0">
                <h2 className="text-base font-semibold text-neutral-900 dark:text-white">{title}</h2>
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
