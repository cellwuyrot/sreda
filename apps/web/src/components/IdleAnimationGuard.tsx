"use client";

/**
 * Suspend cosmetic CSS effects when the browser page or native window is hidden.
 * The desktop shell deliberately disables background throttling for voice; in
 * that mode Chromium Page Visibility may report "visible" even when minimized.
 * New desktop shells report real native state through an optional IPC bridge.
 * Older shells and browsers continue using the Page Visibility API.
 * Audio, screen capture, overlay state and background timers are not stopped.
 */

import { useEffect } from "react";
import { getDesktopApi } from "@/lib/desktop";
import { VISUAL_VISIBILITY_EVENT } from "@/lib/visualVisibility";

export function IdleAnimationGuard() {
  useEffect(() => {
    const root = document.documentElement;

    /* «Простой» — это скрытое окно. Потеря фокуса сама по себе простоем не
       считается: окно рядом с другим окном человек видит, и застывшая
       картинка выглядела бы поломкой. */
    let nativeHidden = false;
    let disposed = false;
    let revision = 0;
    const apply = () => {
      const hidden = document.hidden || nativeHidden;
      if (root.hasAttribute("data-tz-idle") === hidden) return;
      if (hidden) root.setAttribute("data-tz-idle", "1");
      else root.removeAttribute("data-tz-idle");
      document.dispatchEvent(new Event(VISUAL_VISIBILITY_EVENT));
    };

    const desktop = getDesktopApi();
    const unsubscribe = desktop?.onWindowHiddenChange?.((hidden) => {
      revision++;
      nativeHidden = hidden;
      apply();
    });
    const initialRevision = revision;
    desktop?.getWindowHidden?.().then((hidden) => {
      if (disposed || revision !== initialRevision) return;
      nativeHidden = hidden;
      apply();
    }).catch(() => {});

    apply();
    document.addEventListener("visibilitychange", apply);

    /* Системная настройка может измениться на ходу (например, из режима
       экономии батареи), поэтому слушаем её, а не читаем один раз. */
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const applyMotion = () => {
      if (motion?.matches) root.setAttribute("data-tz-still", "1");
      else root.removeAttribute("data-tz-still");
    };
    applyMotion();
    motion?.addEventListener?.("change", applyMotion);

    return () => {
      disposed = true;
      unsubscribe?.();
      document.removeEventListener("visibilitychange", apply);
      motion?.removeEventListener?.("change", applyMotion);
      root.removeAttribute("data-tz-idle");
      root.removeAttribute("data-tz-still");
    };
  }, []);

  return null;
}

export default IdleAnimationGuard;
