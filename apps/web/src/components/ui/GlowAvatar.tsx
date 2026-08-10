"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";

/* ─── Presets ─── */
export const GLOW_PRESETS: Record<string, { label: string; colors: string[] }> = {
  royal:  { label: "Королевский",  colors: ["#8b5cf6", "#6366f1", "#a855f7", "#c084fc", "#818cf8"] },
  flame:  { label: "Пламя",        colors: ["#ef4444", "#f97316", "#fbbf24", "#f97316", "#ef4444"] },
  ocean:  { label: "Океан",        colors: ["#06b6d4", "#3b82f6", "#0ea5e9", "#38bdf8", "#67e8f9"] },
  aurora: { label: "Аврора",       colors: ["#10b981", "#06b6d4", "#22d3ee", "#34d399", "#6ee7b7"] },
  rose:   { label: "Роза",         colors: ["#ec4899", "#f43f5e", "#d946ef", "#fb7185", "#f472b6"] },
  gold:   { label: "Золото",       colors: ["#fbbf24", "#f59e0b", "#fcd34d", "#d97706", "#fef08a"] },
};

export const DEFAULT_GLOW_COLORS = GLOW_PRESETS.royal.colors;

export interface GlowAvatarUser {
  id: string;
  name: string;
  avatar?: string | null;
  role: string;
  avatarGlowEnabled?: boolean;
  avatarGlowColors?: string | null;
}

interface GlowAvatarProps {
  user: GlowAvatarUser;
  size?: number;
  /** Pass online indicator color: "green" | "gray" | undefined (hidden) */
  onlineColor?: "green" | "gray";
  /** Speed in seconds for a full rotation, default 3 */
  speed?: number;
}

function buildGradient(colors: string[]): string {
  // End with same color as start → seamless infinite loop
  return `conic-gradient(${[...colors, colors[0]].join(", ")})`;
}

function buildShadow(colors: string[]): string {
  const hex = colors[0];
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `0 0 14px 3px rgba(${r},${g},${b},0.55)`;
}

export default function GlowAvatar({ user, size = 32, onlineColor, speed = 3 }: GlowAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const RING = Math.max(2, Math.round(size * 0.1));

  /* Кто вправе включить свечение, решает сервер при сохранении (PATCH
     /api/profile/me, привилегия Premium). Здесь достаточно факта «включено»:
     проверка роли на отрисовке означала, что оплативший подписку включал
     свечение, сохранял его и не видел — оно рисовалось только администраторам. */
  const glowActive = !!user.avatarGlowEnabled;

  const colors = useMemo(() => {
    if (!glowActive) return DEFAULT_GLOW_COLORS;
    if (!user.avatarGlowColors) return DEFAULT_GLOW_COLORS;
    try {
      const parsed = JSON.parse(user.avatarGlowColors) as string[];
      if (Array.isArray(parsed) && parsed.length >= 2) return parsed;
    } catch { /* fall through */ }
    return DEFAULT_GLOW_COLORS;
  }, [glowActive, user.avatarGlowColors]);

  const gradient = useMemo(() => buildGradient(colors), [colors]);
  const shadow   = useMemo(() => buildShadow(colors),   [colors]);

  const GLOW_PAD = glowActive ? 6 : 0;
  const initial  = user.name.charAt(0).toUpperCase();

  const spinStyle: React.CSSProperties = {
    animationName: "tz-glow-spin",
    animationDuration: `${speed}s`,
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  };

  return (
    <div
      style={{
        position: "relative",
        // The layout footprint is ALWAYS size x size regardless of glow,
        // so avatars stay aligned and identical in the message list.
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      {glowActive && (
        <>
          {/* Diffuse outer glow — drawn outside the box, doesn't affect layout */}
          <div
            style={{
              position: "absolute",
              inset: -(RING + GLOW_PAD),
              borderRadius: "50%",
              background: gradient,
              filter: "blur(8px)",
              opacity: 0.55,
              pointerEvents: "none",
              ...spinStyle,
            }}
          />
          {/* Sharp ring around the avatar */}
          <div
            style={{
              position: "absolute",
              inset: -RING,
              borderRadius: "50%",
              background: gradient,
              pointerEvents: "none",
              ...spinStyle,
            }}
          />
        </>
      )}

      {/* Avatar — always fills the full size x size box */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          overflow: "hidden",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, rgba(139,92,246,0.25), rgba(99,102,241,0.25))",
          fontSize: Math.round(size * 0.4),
          fontWeight: 700,
        }}
      >
        {user.avatar && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatar}
            alt={user.name}
            // Размеры заданы через style — явные width/height не нужны и не добавляются
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            loading="lazy"
            decoding="async"
            onError={() => setImgError(true)}
          />
        ) : (
          <span style={{ lineHeight: 1 }}>{initial}</span>
        )}
      </div>

      {/* Online indicator */}
      {onlineColor && (
        <span
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: Math.max(8, Math.round(size * 0.28)),
            height: Math.max(8, Math.round(size * 0.28)),
            borderRadius: "50%",
            zIndex: 3,
          }}
        >
          {/* Pulse ring for online */}
          {onlineColor === "green" && (
            <motion.span
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                background: "#22c55e",
              }}
              animate={{ scale: [1, 2, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "easeOut" }}
            />
          )}
          <span
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: onlineColor === "green" ? "#22c55e" : "#9ca3af",
              outline: "2px solid",
              outlineOffset: "-1px",
            }}
            className="outline-white dark:outline-[#171717]"
          />
        </span>
      )}
    </div>
  );
}
