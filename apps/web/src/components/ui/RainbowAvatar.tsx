"use client";

import { useState } from "react";
import Image from "next/image";

/**
 * Usernames that get the animated dark-rainbow glow treatment.
 * Add more as needed.
 */
const GLOW_USERS = new Set(["acoulbot"]);

interface RainbowAvatarProps {
  username: string;
  name: string;
  avatar?: string | null;
  size?: number;
  /** Extra className for the outer wrapper */
  className?: string;
}

/**
 * Avatar component that renders a continuous dark-rainbow glow ring
 * for users in the GLOW_USERS set, and a plain avatar for everyone else.
 */
export default function RainbowAvatar({
  username,
  name,
  avatar,
  size = 40,
  className = "",
}: RainbowAvatarProps) {
  const hasGlow = GLOW_USERS.has(username);
  const initial = name?.charAt(0)?.toUpperCase() ?? "?";
  const [imgError, setImgError] = useState(false);

  const inner = (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        flexShrink: 0,
        position: "relative",
        background: "linear-gradient(135deg, #1a0540 0%, #0a0a1a 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.42,
        fontWeight: 700,
        color: "#fff",
        zIndex: 2,
      }}
    >
      {avatar && !imgError ? (
        <Image
          src={avatar}
          alt={name}
          fill
          style={{ objectFit: "cover" }}
          sizes={`${size}px`}
          onError={() => setImgError(true)}
        />
      ) : (
        initial
      )}

      {/* Shimmer overlay — rotates to create inner light sweep */}
      {hasGlow && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background:
              "conic-gradient(from 0deg, transparent 0%, rgba(255,255,255,0.08) 20%, transparent 40%, rgba(255,255,255,0.05) 60%, transparent 80%, rgba(255,255,255,0.08) 100%)",
            animation: "tz-spin 3s linear infinite",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );

  if (!hasGlow) {
    return (
      <div
        className={className}
        style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0 }}
      >
        {inner}
      </div>
    );
  }

  const pad = Math.round(size * 0.12);
  const outerSize = size + pad * 2;

  return (
    <>
      {/* Inject keyframe once via a <style> tag — Next.js deduplicates identical tags */}
      <style>{`
        @keyframes tz-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes tz-spin-rev {
          from { transform: rotate(360deg); }
          to   { transform: rotate(0deg); }
        }
      `}</style>

      <div
        className={className}
        style={{
          position: "relative",
          width: outerSize,
          height: outerSize,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        title={`${username} — особый участник`}
      >
        {/* Soft outer bloom */}
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: -Math.round(size * 0.1),
            borderRadius: "50%",
            background:
              "conic-gradient(from 90deg, rgba(80,0,140,0.55), rgba(140,0,60,0.55), rgba(100,0,0,0.45), rgba(0,60,140,0.5), rgba(0,100,60,0.4), rgba(80,0,140,0.55))",
            animation: "tz-spin 8s linear infinite",
            filter: "blur(8px)",
            pointerEvents: "none",
          }}
        />

        {/* Outer counter-rotating ring */}
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: -Math.round(size * 0.06),
            borderRadius: "50%",
            background:
              "conic-gradient(from 180deg, #1a0030, #3d0066, #660033, #990000, #663300, #336600, #003366, #000066, #330066, #660066, #1a0030)",
            animation: "tz-spin-rev 6s linear infinite",
            opacity: 0.65,
            pointerEvents: "none",
          }}
        />

        {/* Primary rotating ring */}
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: -Math.round(size * 0.035),
            borderRadius: "50%",
            background:
              "conic-gradient(from 0deg, #1a0030, #3d0066, #660033, #990000, #663300, #336600, #003366, #000066, #330066, #660066, #1a0030)",
            animation: "tz-spin 4s linear infinite",
            pointerEvents: "none",
          }}
        />

        {inner}
      </div>
    </>
  );
}
