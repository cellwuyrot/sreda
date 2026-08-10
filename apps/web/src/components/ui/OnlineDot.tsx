"use client";

import { motion } from "framer-motion";

interface OnlineDotProps {
  online: boolean;
  size?: number;
  className?: string;
}

/**
 * Animated presence indicator.
 * Green with glow-pulse when online, grey static when offline.
 */
export default function OnlineDot({ online, size = 10, className = "" }: OnlineDotProps) {
  return (
    <span
      className={`relative inline-flex ${className}`}
      style={{ width: size, height: size }}
      aria-label={online ? "В сети" : "Не в сети"}
    >
      {online && (
        <motion.span
          className="absolute inset-0 rounded-full bg-green-400"
          animate={{ scale: [1, 1.9, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <span
        className={`relative rounded-full ${online ? "bg-green-400" : "bg-neutral-400 dark:bg-gray-600"}`}
        style={{ width: size, height: size }}
      />
    </span>
  );
}
