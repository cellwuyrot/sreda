import { describe, expect, it } from "vitest";
import { advanceWelcomeScene, WELCOME_FRAME_MS } from "./welcomeSceneTiming";

describe("welcome scene timing", () => {
  it("limits the decorative background to twelve draws per second", () => {
    expect(WELCOME_FRAME_MS).toBeCloseTo(1000 / 12);
  });
  it("advances at the same speed independent of frame rate", () => {
    expect(advanceWelcomeScene(200, 100)).toBeCloseTo(0.096);
    expect(advanceWelcomeScene(150, 100) * 2).toBeCloseTo(0.096);
  });
  it("avoids large jumps after a delay or a new start", () => {
    expect(advanceWelcomeScene(10000, 100)).toBeCloseTo(0.24);
    expect(advanceWelcomeScene(10000, 0)).toBeCloseTo(0.08);
    expect(advanceWelcomeScene(50, 100)).toBe(0);
  });
});
