"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * ConnectSplash — shown for ~1.5s on first load of /connect.
 * Marks itself done in sessionStorage so it only shows once per tab.
 */
export default function ConnectSplash({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<"in" | "hold" | "out">("in");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("hold"), 400);
    const t2 = setTimeout(() => setPhase("out"), 1400);
    const t3 = setTimeout(() => onDone(), 1700);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  return (
    <AnimatePresence>
      {phase !== "out" ? (
        <motion.div
          key="splash"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[90] flex flex-col items-center justify-center"
          style={{ background: "var(--cn-main, #12121c)" }}
        >
          {/* Logo ring */}
          <div className="relative flex items-center justify-center mb-6">
            {/* Spinning ring */}
            <motion.div
              className="absolute w-24 h-24 rounded-full border-2 border-transparent"
              style={{ borderTopColor: "var(--cn-accent, #00d4ff)", borderRightColor: "var(--cn-accent, #00d4ff)" }}
              animate={{ rotate: 360 }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
            />
            {/* Static outer ring */}
            <div className="w-24 h-24 rounded-full border border-white/[0.06]" />

            {/* Logo / icon */}
            <motion.div
              className="absolute flex items-center justify-center"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.15, type: "spring", damping: 16, stiffness: 240 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.png"
                alt="TZ.Connect"
                className="w-14 h-14 rounded-2xl object-cover select-none"
                draggable={false}
              />
            </motion.div>
          </div>

          {/* Name */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.4 }}
            className="text-center"
          >
            <h1
              className="text-xl font-bold tracking-widest uppercase"
              style={{ color: "var(--cn-text, #e8eaf0)", letterSpacing: "0.2em" }}
            >
              TZ.Connect
            </h1>
            <p className="text-xs mt-1.5" style={{ color: "var(--cn-muted, #4a5568)" }}>
              Экосистема TrioZ
            </p>
          </motion.div>

          {/* Progress dots */}
          <motion.div
            className="flex gap-1.5 mt-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            {[0, 1, 2].map(i => (
              <motion.span
                key={i}
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: "var(--cn-accent, #00d4ff)" }}
                animate={{ opacity: [0.2, 1, 0.2] }}
                transition={{ duration: 1, delay: i * 0.2, repeat: Infinity, ease: "easeInOut" }}
              />
            ))}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
