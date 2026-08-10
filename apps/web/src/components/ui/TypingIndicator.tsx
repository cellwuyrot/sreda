"use client";

import { motion, AnimatePresence } from "framer-motion";

interface TypingIndicatorProps {
  names: string[];
}

/**
 * Animated typing indicator with bouncing dots.
 * Replaces the static "X печатает..." text.
 */
export default function TypingIndicator({ names }: TypingIndicatorProps) {
  const text =
    names.length === 0 ? null
    : names.length === 1 ? `${names[0]} печатает`
    : names.length <= 3 ? `${names.join(", ")} печатают`
    : `${names.slice(0, 3).join(", ")} +${names.length - 3} печатают`;

  return (
    <AnimatePresence>
      {text && (
        <motion.div
          key="typing"
          initial={{ opacity: 0, y: 6, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: 6, height: 0 }}
          transition={{ duration: 0.18 }}
          className="flex items-center gap-1.5 px-4 py-1.5"
        >
          {/* Bubble with dots */}
          <div className="flex items-center gap-1 bg-neutral-100 dark:bg-white/8 rounded-full px-2.5 py-1.5 shadow-sm">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="block w-1.5 h-1.5 rounded-full bg-neutral-400 dark:bg-gray-400"
                animate={{ y: [0, -4, 0] }}
                transition={{
                  duration: 0.7,
                  repeat: Infinity,
                  delay: i * 0.15,
                  ease: "easeInOut",
                }}
              />
            ))}
          </div>
          <span className="text-xs text-neutral-400 dark:text-gray-500">
            {text}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
