"use client";

import { useMemo } from "react";

/**
 * Deterministic pseudo-random generator.
 *
 * We must render the exact same starfield on the server and the client,
 * otherwise React throws a hydration mismatch. A plain `Math.random()` would
 * differ between the two passes, so we derive every value from a fixed seed.
 */
function seeded(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

interface Star {
  x: number;
  y: number;
  size: number;
  duration: number;
  delay: number;
  bright: boolean;
}

function useStars(count: number, seed: number): Star[] {
  return useMemo(() => {
    const rand = seeded(seed);
    const stars: Star[] = [];
    for (let i = 0; i < count; i++) {
      stars.push({
        x: rand() * 100,
        y: rand() * 100,
        size: 0.6 + rand() * 1.9,
        duration: 2.5 + rand() * 5,
        delay: rand() * 6,
        bright: rand() > 0.82,
      });
    }
    return stars;
  }, [count, seed]);
}

/** Concentric orbital rings with dots gliding along them (pure SVG + CSS). */
function OrbitSystem() {
  return (
    <svg
      className="absolute left-1/2 top-[8%] -translate-x-1/2 w-[900px] h-[900px] max-w-none opacity-[0.5] dark:opacity-60"
      viewBox="0 0 600 600"
      fill="none"
      aria-hidden
    >
      <defs>
        <radialGradient id="tz-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.55" />
          <stop offset="60%" stopColor="rgb(var(--accent))" stopOpacity="0.08" />
          <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Soft glowing core */}
      <circle cx="300" cy="300" r="120" fill="url(#tz-core)" className="tz-float-y" />

      {/* Rings */}
      {[110, 175, 245].map((r, i) => (
        <circle
          key={r}
          cx="300"
          cy="300"
          r={r}
          stroke="rgb(var(--accent))"
          strokeOpacity={0.18 - i * 0.03}
          strokeWidth={1}
          strokeDasharray={i === 1 ? "2 10" : undefined}
        />
      ))}

      {/* Orbiting bodies — each <g> rotates around the centre */}
      <g className="tz-orbit-spin" style={{ transformOrigin: "300px 300px" }}>
        <circle cx="300" cy="55" r="4" fill="rgb(var(--accent))" />
        <circle cx="300" cy="55" r="10" fill="rgb(var(--accent))" fillOpacity="0.18" />
      </g>
      <g className="tz-orbit-spin-rev" style={{ transformOrigin: "300px 300px" }}>
        <circle cx="475" cy="300" r="3" fill="#8b5cf6" />
      </g>
      <g className="tz-orbit-spin" style={{ transformOrigin: "300px 300px", animationDuration: "45s" }}>
        <circle cx="125" cy="300" r="2.5" fill="#00f0ff" />
      </g>
    </svg>
  );
}

/**
 * Full-viewport cosmic backdrop: layered nebulae, a twinkling starfield, an
 * orbital system and a couple of shooting stars. Fixed and non-interactive so
 * it sits calmly behind the page content in both light and dark themes.
 */
export default function CosmicBackground() {
  const stars = useStars(90, 20260711);

  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
      {/* Base wash — deep space (dark) / violet twilight (light) */}
      <div className="absolute inset-0 bg-gradient-to-b from-indigo-100 via-violet-50 to-white dark:from-[#05060f] dark:via-[#08040f] dark:to-black" />

      {/* Nebula clouds */}
      <div className="tz-nebula-drift absolute -top-40 -left-32 w-[620px] h-[620px] rounded-full blur-[130px] bg-violet-400/25 dark:bg-fantasy-purple/20" />
      <div
        className="tz-nebula-drift absolute top-1/3 -right-40 w-[560px] h-[560px] rounded-full blur-[140px] bg-cyan-300/20 dark:bg-cyan-500/[0.12]"
        style={{ animationDelay: "-8s" }}
      />
      <div
        className="tz-nebula-drift absolute -bottom-48 left-1/4 w-[600px] h-[600px] rounded-full blur-[150px] bg-fuchsia-300/20 dark:bg-fantasy-red/[0.08]"
        style={{ animationDelay: "-14s" }}
      />

      {/* Orbital system behind the hero */}
      <OrbitSystem />

      {/* Twinkling starfield */}
      {stars.map((s, i) => (
        <span
          key={i}
          className="tz-twinkle absolute rounded-full bg-violet-500/70 dark:bg-white"
          style={
            {
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.size,
              height: s.size,
              "--tz-dur": `${s.duration}s`,
              animationDelay: `${s.delay}s`,
              boxShadow: s.bright ? "0 0 6px 1px currentColor" : undefined,
            } as React.CSSProperties
          }
        />
      ))}

      {/* Shooting stars */}
      <span
        className="tz-shoot absolute h-px w-40 top-[14%] left-[70%]
          bg-gradient-to-l from-violet-400/80 dark:from-white to-transparent"
        style={{ ["--tz-dur" as string]: "9s", ["--tz-delay" as string]: "1.5s" }}
      />
      <span
        className="tz-shoot absolute h-px w-28 top-[42%] left-[82%]
          bg-gradient-to-l from-cyan-400/80 dark:from-cyan-200 to-transparent"
        style={{ ["--tz-dur" as string]: "13s", ["--tz-delay" as string]: "6s" }}
      />

      {/* Vignette to seat the content */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.04)_100%)] dark:bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(0,0,0,0.55)_100%)]" />
    </div>
  );
}
