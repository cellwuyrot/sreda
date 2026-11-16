/** The welcome background is decorative: cap redraws and preserve the time-based phase. */
export const WELCOME_FRAME_MS = 1000 / 12;
const SCENE_UNITS_PER_MS = 0.00096;
const MAX_ELAPSED_MS = 250;

export function advanceWelcomeScene(now: number, lastDraw: number): number {
  const elapsed = lastDraw === 0 ? WELCOME_FRAME_MS : Math.max(0, now - lastDraw);
  return Math.min(elapsed, MAX_ELAPSED_MS) * SCENE_UNITS_PER_MS;
}
