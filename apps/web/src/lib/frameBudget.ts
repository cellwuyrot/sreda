/** Limit cosmetic canvas redraws while keeping the simulation time-based. */
export function createFrameBudget(maxFps = 30, referenceFps = 60) {
  let last: number | null = null;
  return {
    consume(now: number): number {
      if (last === null) { last = now; return 1; }
      const elapsed = now - last;
      // A small tolerance handles rounded timestamps at common refresh rates.
      if (elapsed < 1000 / maxFps - 0.5) return 0;
      last = now;
      // Avoid a large jump after a stalled render thread.
      return Math.min(4, elapsed * referenceFps / 1000);
    },
    reset(): void { last = null; },
  };
}
