"use client";

import { motion } from "framer-motion";

interface AudioBarsProps {
  /** Number of bars */
  bars?: number;
  /** Color class e.g. "bg-green-400" */
  color?: string;
  /** Height in px of the tallest bar */
  maxH?: number;
  className?: string;
}

const HEIGHTS = [0.4, 0.9, 0.6, 1.0, 0.7, 0.5, 0.85, 0.65, 0.45, 0.75];

/**
 * Animated EQ-style audio bars shown when a user is speaking.
 */
export default function AudioBars({
  bars = 5,
  color = "bg-green-400",
  maxH = 16,
  className = "",
}: AudioBarsProps) {
  return (
    <span
      className={`inline-flex items-end gap-[2px] ${className}`}
      aria-hidden="true"
      style={{ height: maxH }}
    >
      {Array.from({ length: bars }).map((_, i) => {
        const base = HEIGHTS[i % HEIGHTS.length];
        return (
          <motion.span
            key={i}
            className={`block w-[3px] rounded-full ${color}`}
            style={{ originY: 1 }}
            animate={{
              height: [
                Math.round(maxH * base * 0.4),
                Math.round(maxH * base),
                Math.round(maxH * base * 0.6),
                Math.round(maxH * base * 0.9),
                Math.round(maxH * base * 0.3),
              ],
            }}
            transition={{
              duration: 0.55 + i * 0.07,
              repeat: Infinity,
              repeatType: "reverse",
              ease: "easeInOut",
              delay: i * 0.06,
            }}
          />
        );
      })}
    </span>
  );
}
