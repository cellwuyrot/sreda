"use client";

import { useEffect, useRef, useState } from "react";

/** Decorative live levels from the recorder's existing stream; never opens a second microphone. */
export default function RecordingWaveform({ stream }: { stream: MediaStream }) {
  const bars = useRef<HTMLSpanElement>(null);
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let alive = true;
    let context: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let focused = document.hasFocus();
    const stopTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    const canRun = () => alive && focused && document.visibilityState === "visible" && !motion?.matches;
    try {
      if (typeof AudioContext === "undefined") return;
      context = new AudioContext();
      analyser = context.createAnalyser();
      analyser.fftSize = 64;
      source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      setAvailable(true);
    } catch {
      void context?.close().catch(() => {});
      return;
    }
    const samples = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      timer = undefined;
      if (!canRun() || !analyser) return;
      analyser.getByteFrequencyData(samples);
      const children = bars.current?.children;
      if (children) for (let i = 0; i < children.length; i++) {
        const level = samples[Math.min(samples.length - 1, 2 + i * 3)] / 255;
        (children[i] as HTMLElement).style.transform = `scaleY(${Math.max(0.18, level)})`;
      }
      timer = setTimeout(tick, 120);
    };
    const sync = () => {
      stopTimer();
      if (!context) return;
      if (canRun()) { void context.resume().catch(() => {}); tick(); }
      else { void context.suspend().catch(() => {}); }
    };
    const onFocus = () => { focused = true; sync(); };
    const onBlur = () => { focused = false; sync(); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", sync);
    motion?.addEventListener("change", sync);
    sync();
    return () => {
      alive = false; stopTimer();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", sync);
      motion?.removeEventListener("change", sync);
      source?.disconnect(); analyser?.disconnect();
      void context?.close().catch(() => {});
    };
  }, [stream]);
  if (!available) return null;
  return <span ref={bars} aria-hidden="true" className="inline-flex h-4 items-center gap-0.5 motion-reduce:hidden">
    {[0, 1, 2, 3, 4].map(i => <span key={i} className="h-4 w-0.5 rounded-full bg-cyan-400" style={{ transform: "scaleY(.18)" }} />)}
  </span>;
}
