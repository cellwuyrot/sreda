import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WelcomeBackgroundVideo } from "./ConnectWelcome";
import { VISUAL_VISIBILITY_EVENT } from "@/lib/visualVisibility";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-tz-idle");
  vi.restoreAllMocks();
});

it("pauses only decorative background video while hidden and resumes on restore", () => {
  let paused = false;
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(() => paused);
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => { paused = true; });
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => { paused = false; return Promise.resolve(); });
  const { container } = render(<WelcomeBackgroundVideo />);
  const video = container.querySelector("video");
  expect(video?.getAttribute("src")).toBe("/uploads/banners/backgroundvid.mp4");
  expect(video?.loop).toBe(true);
  expect(pause).not.toHaveBeenCalled();
  document.documentElement.setAttribute("data-tz-idle", "1");
  act(() => document.dispatchEvent(new Event(VISUAL_VISIBILITY_EVENT)));
  expect(pause).toHaveBeenCalledOnce();
  document.documentElement.removeAttribute("data-tz-idle");
  act(() => document.dispatchEvent(new Event(VISUAL_VISIBILITY_EVENT)));
  expect(play).toHaveBeenCalledOnce();
});
