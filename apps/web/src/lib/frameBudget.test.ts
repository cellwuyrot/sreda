import { describe, expect, it } from "vitest";
import { createFrameBudget } from "./frameBudget";

describe("cosmetic animation frame budget", () => {
  it.each([60, 144, 240])("limits repaint rate at %s Hz while preserving simulation speed", (refresh) => {
    const budget = createFrameBudget();
    let draws = 0, elapsedUnits = 0;
    for (let i = 0; i <= refresh; i++) {
      const units = budget.consume(i * 1000 / refresh);
      if (units) { draws++; elapsedUnits += units; }
    }
    expect(draws).toBeLessThanOrEqual(31);
    expect(draws).toBeGreaterThanOrEqual(25);
    expect(elapsedUnits).toBeGreaterThan(56);
    expect(elapsedUnits).toBeLessThan(63);
  });
  it("resets on resume and clamps long stalls", () => {
    const budget = createFrameBudget();
    expect(budget.consume(0)).toBe(1);
    expect(budget.consume(10)).toBe(0);
    expect(budget.consume(5000)).toBe(4);
    budget.reset();
    expect(budget.consume(99999)).toBe(1);
  });
});
