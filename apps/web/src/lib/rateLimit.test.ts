/**
 * Тесты ограничителя запросов (rateLimit).
 *
 * Redis недоступен — мокаем модуль @/lib/redis так, чтобы статус был не "ready".
 * В этом случае rateLimit.ts переключается на in-memory LRU (rateLimitMemory).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Мок Redis: статус "end" → модуль переключается на in-memory путь.
vi.mock("@/lib/redis", () => ({
  redis: {
    status: "end",
    eval: vi.fn().mockResolvedValue(0),
  },
}));

// Мок next/server чтобы не тянуть полный Next-рантайм.
vi.mock("next/server", async () => {
  const { NextResponse: RealNextResponse } = await import("next/server");
  return { NextResponse: RealNextResponse, NextRequest: vi.fn() };
});

import { rateLimit } from "@/lib/rateLimit";

/** Создаёт минимальный NextRequest с нужным IP. */
function makeRequest(ip: string): import("next/server").NextRequest {
  const req = new Request("http://localhost/api/test");
  Object.defineProperty(req, "headers", {
    value: new Headers({ "x-forwarded-for": ip }),
    writable: false,
  });
  return req as unknown as import("next/server").NextRequest;
}

describe("rateLimit (in-memory)", () => {
  // Каждый тест стартует с чистым состоянием — перезагружаем модуль.
  beforeEach(async () => {
    vi.resetModules();
    vi.mock("@/lib/redis", () => ({
      redis: { status: "end", eval: vi.fn().mockResolvedValue(0) },
    }));
  });

  it("пропускает запросы в пределах лимита", async () => {
    const { rateLimit: rl } = await import("@/lib/rateLimit");
    const req = makeRequest("1.2.3.4");
    for (let i = 0; i < 3; i++) {
      const result = await rl(req, "test-pass", { limit: 3, windowMs: 60_000 });
      expect(result).toBeNull();
    }
  });

  it("N+1-й запрос в окне получает 429", async () => {
    const { rateLimit: rl } = await import("@/lib/rateLimit");
    const req = makeRequest("2.2.2.2");
    const opts = { limit: 2, windowMs: 60_000 };
    await rl(req, "test-exceed", opts);
    await rl(req, "test-exceed", opts);
    const result = await rl(req, "test-exceed", opts); // третий — сверх лимита
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it("заголовок Retry-After присутствует в ответе 429", async () => {
    const { rateLimit: rl } = await import("@/lib/rateLimit");
    const req = makeRequest("3.3.3.3");
    const opts = { limit: 1, windowMs: 5_000 };
    await rl(req, "test-headers", opts);
    const res = await rl(req, "test-headers", opts);
    expect(res).not.toBeNull();
    expect(res!.headers.get("Retry-After")).toBe("5");
    expect(res!.headers.get("X-RateLimit-Limit")).toBe("1");
    expect(res!.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("ключ лимита разделяет разных пользователей / адреса", async () => {
    const { rateLimit: rl } = await import("@/lib/rateLimit");
    const opts = { limit: 1, windowMs: 60_000 };
    const req1 = makeRequest("10.0.0.1");
    const req2 = makeRequest("10.0.0.2");

    // Исчерпываем лимит для первого IP.
    await rl(req1, "test-isolation", opts);
    const blocked1 = await rl(req1, "test-isolation", opts);
    expect(blocked1).not.toBeNull();
    expect(blocked1!.status).toBe(429);

    // Второй IP ещё не превысил лимит.
    const allowed2 = await rl(req2, "test-isolation", opts);
    expect(allowed2).toBeNull();
  });

  it("разные ключи операции не мешают друг другу", async () => {
    const { rateLimit: rl } = await import("@/lib/rateLimit");
    const req = makeRequest("4.4.4.4");
    const opts = { limit: 1, windowMs: 60_000 };

    // Исчерпываем лимит для ключа "op-a".
    await rl(req, "op-a", opts);
    const blockedA = await rl(req, "op-a", opts);
    expect(blockedA!.status).toBe(429);

    // Ключ "op-b" для того же IP — счётчик отдельный.
    const allowedB = await rl(req, "op-b", opts);
    expect(allowedB).toBeNull();
  });

  it("в новом окне счётчик обнуляется", async () => {
    vi.useFakeTimers();
    const { rateLimit: rl } = await import("@/lib/rateLimit");
    const req = makeRequest("5.5.5.5");
    const windowMs = 1_000;
    const opts = { limit: 1, windowMs };

    await rl(req, "test-window", opts);
    const blocked = await rl(req, "test-window", opts);
    expect(blocked!.status).toBe(429);

    // Перематываем время за пределы окна.
    vi.advanceTimersByTime(windowMs + 100);

    const allowed = await rl(req, "test-window", opts);
    expect(allowed).toBeNull();
    vi.useRealTimers();
  });

  it("IP берётся из первого значения x-forwarded-for (список)", async () => {
    const { rateLimit: rl } = await import("@/lib/rateLimit");
    // Заголовок содержит цепочку прокси — берём крайний левый (клиентский).
    const req = {
      headers: {
        get: (name: string) => {
          if (name === "x-forwarded-for") return "9.9.9.9, 1.1.1.1, 2.2.2.2";
          return null;
        },
      },
    } as unknown as import("next/server").NextRequest;

    const opts = { limit: 1, windowMs: 60_000 };
    await rl(req, "test-xff", opts);
    const blocked = await rl(req, "test-xff", opts);
    expect(blocked!.status).toBe(429);

    // Другой «первый» IP — отдельный счётчик.
    const req2 = {
      headers: {
        get: (name: string) => {
          if (name === "x-forwarded-for") return "8.8.8.8, 1.1.1.1";
          return null;
        },
      },
    } as unknown as import("next/server").NextRequest;
    const allowed = await rl(req2, "test-xff", opts);
    expect(allowed).toBeNull();
  });
});
