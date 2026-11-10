/** Visual work may pause only when the page or native window is hidden. */
export const VISUAL_VISIBILITY_EVENT = "trioz:visual-visibility";
export function isVisualHidden(): boolean {
  return document.hidden || document.documentElement.hasAttribute("data-tz-idle");
}
