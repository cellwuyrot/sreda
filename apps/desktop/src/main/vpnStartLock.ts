/** Synchronous reservation across the two native tunnel start paths. */
let held = false;
export function acquireVpnStart(): (() => void) | null {
  if (held) return null;
  held = true;
  let released = false;
  return () => { if (!released) { released = true; held = false; } };
}
