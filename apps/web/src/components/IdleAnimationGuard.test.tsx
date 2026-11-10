import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdleAnimationGuard } from "./IdleAnimationGuard";
import { VISUAL_VISIBILITY_EVENT } from "@/lib/visualVisibility";

afterEach(() => {
  cleanup();
  delete window.triozDesktop;
  document.documentElement.removeAttribute("data-tz-idle");
  document.documentElement.removeAttribute("data-tz-still");
  vi.restoreAllMocks();
});

describe("native window visual visibility", () => {
  it("pauses on minimize, resumes on restore and ignores a stale initial reply", async () => {
    let notify: (hidden: boolean) => void = () => {};
    let resolveInitial!: (value: boolean) => void;
    const initial = new Promise<boolean>((resolve) => { resolveInitial = resolve; });
    const unsubscribe = vi.fn();
    window.triozDesktop = {
      isDesktop: true, platform: "win32",
      getWindowHidden: () => initial,
      onWindowHiddenChange: (cb: (hidden: boolean) => void) => { notify = cb; return unsubscribe; },
    } as unknown as typeof window.triozDesktop;
    const listener = vi.fn();
    document.addEventListener(VISUAL_VISIBILITY_EVENT, listener);
    const view = render(<IdleAnimationGuard />);
    expect(document.documentElement.hasAttribute("data-tz-idle")).toBe(false);
    act(() => notify(true));
    expect(document.documentElement.hasAttribute("data-tz-idle")).toBe(true);
    await act(async () => { resolveInitial(false); await initial; });
    expect(document.documentElement.hasAttribute("data-tz-idle")).toBe(true);
    act(() => notify(false));
    expect(document.documentElement.hasAttribute("data-tz-idle")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
    document.removeEventListener(VISUAL_VISIBILITY_EVENT, listener);
  });
  it("still handles ordinary browser visibility without a desktop bridge", () => {
    let hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    render(<IdleAnimationGuard />);
    hidden = true;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(document.documentElement.hasAttribute("data-tz-idle")).toBe(true);
    hidden = false;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(document.documentElement.hasAttribute("data-tz-idle")).toBe(false);
  });
});
