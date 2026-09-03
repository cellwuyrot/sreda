/**
 * Тесты: NETLINK — расход трафика, лимит и его отсутствие.
 *
 * Главное, что здесь закреплено: безлимит даёт РОЛЬ В ПРОЕКТЕ и только она.
 * Ни Premium, ни подписка «Ускоренный интернет» лимита не снимают — по части
 * соединения это одна и та же услуга с одним лимитом. И отдельно: «расход не
 * приходил с узла» — не то же самое, что «израсходовано 0».
 */
import { describe, it, expect } from "vitest";
import {
  BYTES_IN_GB,
  formatTraffic,
  isTrafficBlocked,
  isUsageUnlimited,
  periodExpired,
  usageView,
} from "./connectionUsage";

const NOW = new Date("2026-09-10T12:00:00.000Z");
/** Период начался четыре дня назад — то есть идёт. */
const RESET_AT = new Date("2026-09-06T12:00:00.000Z");

const SETTINGS = {
  trafficLimitGb: 250,
  usagePeriodDays: 30,
  overLimitAction: "BLOCK",
  throttleKbps: 2048,
};

function peer(gb: number, extra: { usageUpdatedAt?: Date | null } = {}) {
  return {
    rxBytes: gb * BYTES_IN_GB * 0.5,
    txBytes: gb * BYTES_IN_GB * 0.5,
    usageResetAt: RESET_AT,
    usageUpdatedAt: extra.usageUpdatedAt === undefined ? NOW : extra.usageUpdatedAt,
  };
}

describe("isUsageUnlimited", () => {
  it("администрация проекта — без лимита", () => {
    expect(isUsageUnlimited({ role: "ADMIN" })).toBe(true);
  });

  it("все остальные — по общему лимиту, включая редактора и партнёра", () => {
    expect(isUsageUnlimited({ role: "EDITOR" })).toBe(false);
    expect(isUsageUnlimited({ role: "USER" })).toBe(false);
    expect(isUsageUnlimited({ role: "CONSULTANT" })).toBe(false);
    expect(isUsageUnlimited(null)).toBe(false);
    expect(isUsageUnlimited({})).toBe(false);
  });
});

describe("usageView", () => {
  it("считает расход и остаток в текущем периоде", () => {
    const view = usageView(peer(10), SETTINGS, NOW);
    expect(view.usedBytes).toBe(10 * BYTES_IN_GB);
    expect(view.limitBytes).toBe(250 * BYTES_IN_GB);
    expect(view.remainingBytes).toBe(240 * BYTES_IN_GB);
    expect(view.share).toBe(4);
    expect(view.overLimit).toBe(false);
    expect(view.unlimited).toBe(false);
  });

  it("расход выше лимита — лимит исчерпан", () => {
    const view = usageView(peer(260), SETTINGS, NOW);
    expect(view.overLimit).toBe(true);
    expect(view.remainingBytes).toBe(0);
    expect(view.share).toBe(100);
  });

  it("безлимит: расход виден, лимита и перерасхода нет", () => {
    const view = usageView(peer(900), SETTINGS, NOW, true);
    expect(view.usedBytes).toBe(900 * BYTES_IN_GB);
    expect(view.limitBytes).toBe(0);
    expect(view.remainingBytes).toBeNull();
    expect(view.overLimit).toBe(false);
    expect(view.unlimited).toBe(true);
  });

  it("учёт с узла не приходил — measuredAt пуст, а не «ноль расхода»", () => {
    expect(usageView(peer(0, { usageUpdatedAt: null }), SETTINGS, NOW).measuredAt).toBeNull();
    expect(usageView(peer(3), SETTINGS, NOW).measuredAt).toBe(NOW.toISOString());
  });

  it("срок периода вышел — расход нулевой и период новый", () => {
    const old = { rxBytes: 5 * BYTES_IN_GB, txBytes: 0, usageResetAt: new Date("2026-01-01T00:00:00.000Z") };
    const view = usageView(old, SETTINGS, NOW);
    expect(view.usedBytes).toBe(0);
    expect(view.periodStart).toBe(NOW.toISOString());
  });

  it("без пира — нули и никакого перерасхода", () => {
    const view = usageView(null, SETTINGS, NOW);
    expect(view.usedBytes).toBe(0);
    expect(view.overLimit).toBe(false);
  });
});

describe("isTrafficBlocked", () => {
  it("подписчик за лимитом при правиле «отключить» — снимаем соединение", () => {
    expect(isTrafficBlocked(peer(300), SETTINGS, NOW)).toBe(true);
  });

  it("администрация проекта за той же цифрой — соединение остаётся", () => {
    expect(isTrafficBlocked(peer(300), SETTINGS, NOW, true)).toBe(false);
  });

  it("правило «снизить скорость» соединение не снимает", () => {
    expect(isTrafficBlocked(peer(300), { ...SETTINGS, overLimitAction: "THROTTLE" }, NOW)).toBe(false);
  });

  it("нулевой лимит в настройках — ограничения нет ни у кого", () => {
    expect(isTrafficBlocked(peer(300), { ...SETTINGS, trafficLimitGb: 0 }, NOW)).toBe(false);
  });
});

describe("periodExpired", () => {
  it("внутри периода — нет, за его пределами — да", () => {
    expect(periodExpired(RESET_AT, 30, NOW)).toBe(false);
    expect(periodExpired(new Date("2026-07-01T00:00:00.000Z"), 30, NOW)).toBe(true);
  });
});

describe("formatTraffic", () => {
  it("мелкий расход не превращается в ноль", () => {
    expect(formatTraffic(700 * 1024 * 1024)).toBe("700 МБ");
    expect(formatTraffic(0)).toBe("0 ГБ");
  });
});
