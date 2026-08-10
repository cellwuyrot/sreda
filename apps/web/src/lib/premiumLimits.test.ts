import { describe, it, expect } from "vitest";
import {
  FREE_UPLOAD_MB,
  PREMIUM_UPLOAD_MB,
  FREE_SCHEDULED_QUEUE,
  FREE_GROUP_EMOJI,
  PREMIUM_GROUP_EMOJI,
  EMOJI_SIZE_PX,
  FREE_PINS,
  PREMIUM_PINS,
  uploadLimitBytes,
  pinLimit,
  groupEmojiLimit,
  scheduledQueueLimit,
} from "@/lib/premiumLimits";

// ─── Константы: фиксируем каждое число ─────────────────────────────────────

describe("константы premiumLimits", () => {
  it("FREE_UPLOAD_MB = 10", () => {
    expect(FREE_UPLOAD_MB).toBe(10);
  });

  it("PREMIUM_UPLOAD_MB = 100", () => {
    expect(PREMIUM_UPLOAD_MB).toBe(100);
  });

  it("FREE_SCHEDULED_QUEUE = 2", () => {
    expect(FREE_SCHEDULED_QUEUE).toBe(2);
  });

  it("FREE_GROUP_EMOJI = 5", () => {
    expect(FREE_GROUP_EMOJI).toBe(5);
  });

  it("PREMIUM_GROUP_EMOJI = 20", () => {
    expect(PREMIUM_GROUP_EMOJI).toBe(20);
  });

  it("EMOJI_SIZE_PX = 128", () => {
    expect(EMOJI_SIZE_PX).toBe(128);
  });

  it("FREE_PINS = 10", () => {
    expect(FREE_PINS).toBe(10);
  });

  it("PREMIUM_PINS = 50", () => {
    expect(PREMIUM_PINS).toBe(50);
  });
});

// ─── uploadLimitBytes ────────────────────────────────────────────────────────

describe("uploadLimitBytes", () => {
  it("free: 10 МБ в байтах", () => {
    expect(uploadLimitBytes(false)).toBe(10 * 1024 * 1024);
  });

  it("premium: 100 МБ в байтах", () => {
    expect(uploadLimitBytes(true)).toBe(100 * 1024 * 1024);
  });

  it("premium ровно в 10 раз больше free", () => {
    expect(uploadLimitBytes(true)).toBe(uploadLimitBytes(false) * 10);
  });
});

// ─── pinLimit ────────────────────────────────────────────────────────────────

describe("pinLimit", () => {
  it("free: 10 закреплённых", () => {
    expect(pinLimit(false)).toBe(10);
  });

  it("premium: 50 закреплённых", () => {
    expect(pinLimit(true)).toBe(50);
  });

  it("граница free: 10-й пин разрешён (count <= limit)", () => {
    const limit = pinLimit(false);
    expect(10 <= limit).toBe(true);
  });

  it("граница free: 11-й пин запрещён (count > limit)", () => {
    const limit = pinLimit(false);
    expect(11 > limit).toBe(true);
  });

  it("граница premium: 50-й пин разрешён", () => {
    const limit = pinLimit(true);
    expect(50 <= limit).toBe(true);
  });

  it("граница premium: 51-й пин запрещён", () => {
    const limit = pinLimit(true);
    expect(51 > limit).toBe(true);
  });
});

// ─── groupEmojiLimit ─────────────────────────────────────────────────────────

describe("groupEmojiLimit", () => {
  it("free (ownerPremium=false): 5 эмодзи", () => {
    expect(groupEmojiLimit(false)).toBe(5);
  });

  it("premium (ownerPremium=true): 20 эмодзи", () => {
    expect(groupEmojiLimit(true)).toBe(20);
  });

  it("граница free: 5-й эмодзи разрешён", () => {
    const limit = groupEmojiLimit(false);
    expect(5 <= limit).toBe(true);
  });

  it("граница free: 6-й эмодзи запрещён", () => {
    const limit = groupEmojiLimit(false);
    expect(6 > limit).toBe(true);
  });

  it("граница premium: 20-й эмодзи разрешён", () => {
    const limit = groupEmojiLimit(true);
    expect(20 <= limit).toBe(true);
  });

  it("граница premium: 21-й эмодзи запрещён", () => {
    const limit = groupEmojiLimit(true);
    expect(21 > limit).toBe(true);
  });
});

// ─── scheduledQueueLimit ─────────────────────────────────────────────────────

describe("scheduledQueueLimit", () => {
  it("premium: возвращает null (очередь без ограничений)", () => {
    expect(scheduledQueueLimit(true)).toBeNull();
  });

  it("free: возвращает 2", () => {
    expect(scheduledQueueLimit(false)).toBe(2);
  });

  it("граница free: 2-е сообщение разрешено", () => {
    const limit = scheduledQueueLimit(false)!;
    expect(2 <= limit).toBe(true);
  });

  it("граница free: 3-е сообщение запрещено", () => {
    const limit = scheduledQueueLimit(false)!;
    expect(3 > limit).toBe(true);
  });
});
