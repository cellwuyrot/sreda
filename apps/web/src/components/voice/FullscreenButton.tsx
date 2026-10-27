"use client";

import { useEffect, useRef, useState } from "react";

/** Kept inside the requested surface, so controls remain visible in fullscreen. */
export default function FullscreenButton() {
  const ref = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const update = () => setExpanded(document.fullscreenElement === ref.current?.closest("[data-fullscreen-target]"));
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const toggle = async () => {
    const target = ref.current?.closest<HTMLElement>("[data-fullscreen-target]");
    if (!target) return;
    setError("");
    try {
      if (document.fullscreenElement === target) await document.exitFullscreen();
      else if (target.requestFullscreen) await target.requestFullscreen();
      else setError("Полный экран не поддерживается этим браузером");
    } catch {
      setError("Не удалось открыть полный экран. Проверьте разрешения браузера.");
    }
  };
  const label = expanded ? "Выйти из полноэкранного режима" : "На весь экран";
  return <>
    <button ref={ref} type="button" onClick={() => void toggle()} title={label} aria-label={label}
      className="w-8 h-8 rounded-lg text-white/75 hover:text-white hover:bg-white/10 inline-flex shrink-0 items-center justify-center">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d={expanded ? "M8 3v5H3m18 0h-5V3M3 16h5v5m8 0v-5h5" : "M8 3H3v5m18 0V3h-5M3 16v5h5m8 0h5v-5"} />
      </svg>
    </button>
    {error && <span role="alert" className="text-xs text-red-400">{error}</span>}
  </>;
}
