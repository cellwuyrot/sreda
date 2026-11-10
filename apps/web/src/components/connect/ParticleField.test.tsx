import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ParticleField from "./ParticleField";
import { VISUAL_VISIBILITY_EVENT } from "@/lib/visualVisibility";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-tz-idle");
  vi.restoreAllMocks();
});

it("limits cosmetic drawing on a high-refresh screen, pauses when hidden and resumes", () => {
  const callbacks = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((fn) => { callbacks.set(++id, fn); return id; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((n) => { callbacks.delete(n); });
  vi.spyOn(performance, "now").mockReturnValue(0);
  const clearRect = vi.fn();
  const ctx = { clearRect, setTransform: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  render(<ParticleField particles={{ kind: "stars", density: 50, speed: 50, size: 2, color: "#fff", opacity: 50, interactive: false }} />);
  for (let i = 1; i <= 144; i++) {
    const queued = [...callbacks.values()];
    callbacks.clear();
    act(() => queued.forEach((cb) => cb(i * 1000 / 144)));
  }
  expect(clearRect.mock.calls.length).toBeGreaterThanOrEqual(25);
  expect(clearRect.mock.calls.length).toBeLessThanOrEqual(31);
  document.documentElement.setAttribute("data-tz-idle", "1");
  act(() => document.dispatchEvent(new Event(VISUAL_VISIBILITY_EVENT)));
  expect(callbacks.size).toBe(0);
  const before = clearRect.mock.calls.length;
  document.documentElement.removeAttribute("data-tz-idle");
  act(() => document.dispatchEvent(new Event(VISUAL_VISIBILITY_EVENT)));
  const queued = [...callbacks.values()];
  callbacks.clear();
  act(() => queued.forEach((cb) => cb(2000)));
  expect(clearRect.mock.calls.length).toBe(before + 1);
});
