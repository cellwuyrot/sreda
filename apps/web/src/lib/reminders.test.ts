/**
 * Тесты: src/lib/reminders.ts — напоминания на карточках.
 *
 * Напоминание либо срабатывает вовремя, либо не срабатывает вовсе — и второе
 * человек замечает не сразу, а когда уже поздно. Поэтому проверяется то, что
 * ломает срабатывание молча: время в прошлом, промах в поле ввода года,
 * заготовка «сегодня вечером», нажатая поздно вечером.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_AHEAD_MS,
  REMINDER_PRESETS,
  isValidRemindAt,
  presetTime,
  reminderLabel,
  reminderState,
  reminderTitle,
  sanitizeReminderLink,
} from "@/lib/reminders";

/** Полдень 2 августа 2026 года по местному времени. */
const NOON = new Date(2026, 7, 2, 12, 0, 0, 0).getTime();

describe("заготовки сроков", () => {
  it("через час — ровно через час", () => {
    expect(presetTime("hour", NOON) - NOON).toBe(60 * 60 * 1000);
  });

  it("вечер — сегодня в 18:00", () => {
    const at = new Date(presetTime("evening", NOON));
    expect(at.getHours()).toBe(18);
    expect(at.getDate()).toBe(2);
  });

  it("ИНВАРИАНТ: заготовка не ставит время в прошлом", () => {
    /* Нажали «сегодня вечером» в одиннадцать ночи — напоминание сработало бы
       мгновенно, в первый же обход. Переносим на следующий вечер. */
    const lateNight = new Date(2026, 7, 2, 23, 30).getTime();
    const at = presetTime("evening", lateNight);
    expect(at).toBeGreaterThan(lateNight);
    expect(new Date(at).getDate()).toBe(3);
  });

  it("утро — завтра в 9:00", () => {
    const at = new Date(presetTime("tomorrow", NOON));
    expect(at.getHours()).toBe(9);
    expect(at.getDate()).toBe(3);
  });

  it("все заготовки дают будущее время", () => {
    for (const preset of REMINDER_PRESETS) {
      expect(presetTime(preset.id, NOON), preset.id).toBeGreaterThan(NOON);
    }
  });
});

describe("проверка времени", () => {
  it("будущее принимается, прошлое — нет", () => {
    expect(isValidRemindAt(NOON + 1000, NOON)).toBe(true);
    expect(isValidRemindAt(NOON - 1000, NOON)).toBe(false);
    expect(isValidRemindAt(NOON, NOON)).toBe(false);
  });

  it("ФИКСАЦИЯ: дальше года — почти всегда промах в годе", () => {
    expect(isValidRemindAt(NOON + MAX_AHEAD_MS - 1000, NOON)).toBe(true);
    expect(isValidRemindAt(NOON + MAX_AHEAD_MS + 1000, NOON)).toBe(false);
  });

  it("мусор вместо времени не проходит", () => {
    for (const bad of [null, undefined, "завтра", Number.NaN, Infinity, {}]) {
      expect(isValidRemindAt(bad, NOON), String(bad)).toBe(false);
    }
  });
});

describe("состояние колокольчика", () => {
  it("нет времени — нет напоминания", () => {
    expect(reminderState(null, NOON)).toBe("none");
    expect(reminderState(undefined, NOON)).toBe("none");
  });

  it("будущее — ждёт, прошедшее — сработало", () => {
    expect(reminderState(NOON + 1000, NOON)).toBe("pending");
    expect(reminderState(NOON - 1000, NOON)).toBe("fired");
  });
});

describe("подпись", () => {
  it("ближние сроки называются словами", () => {
    /* «03.08» приходится сверять с календарём, «завтра» понятно сразу. */
    expect(reminderLabel(new Date(2026, 7, 2, 18, 30).getTime(), NOON)).toBe("Сегодня в 18:30");
    expect(reminderLabel(new Date(2026, 7, 3, 9, 0).getTime(), NOON)).toBe("Завтра в 09:00");
  });

  it("дальние — датой", () => {
    expect(reminderLabel(new Date(2026, 7, 20, 7, 5).getTime(), NOON)).toBe("20.08 в 07:05");
  });

  it("прошедшее видно по подписи", () => {
    expect(reminderLabel(NOON - 1000, NOON)).toContain("прошло");
  });

  it("без времени — приглашение поставить", () => {
    expect(reminderLabel(null, NOON)).toBe("Напомнить");
  });
});

describe("адрес и заголовок уведомления", () => {
  it("ИНВАРИАНТ: уведомление не уводит на чужой сайт", () => {
    /* Адрес приходит от страницы и уходит в шторку телефона. `//evil.tld`
       браузер понимает как чужой сайт, а не как путь внутри своего. */
    for (const bad of ["//evil.tld", "https://evil.tld", "javascript:alert(1)", "\\\\evil", "workspace"]) {
      expect(sanitizeReminderLink(bad), bad).toBe("/workspace");
    }
    expect(sanitizeReminderLink("/connect?section=dm&dm=1")).toBe("/connect?section=dm&dm=1");
  });

  it("слишком длинный адрес отбрасывается", () => {
    expect(sanitizeReminderLink(`/workspace?x=${"a".repeat(400)}`)).toBe("/workspace");
  });

  it("безымянная карточка получает понятный заголовок", () => {
    expect(reminderTitle("  ")).toBe("Карточка без названия");
    expect(reminderTitle(null)).toBe("Карточка без названия");
    expect(reminderTitle("  Позвонить в банк ")).toBe("Позвонить в банк");
  });

  it("длинный заголовок обрезается", () => {
    expect(reminderTitle("я".repeat(500)).length).toBe(120);
  });
});
