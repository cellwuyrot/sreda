import { LRUCache } from "lru-cache";
import { NextRequest, NextResponse } from "next/server";
import { redis } from "./redis";

type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

const memoryCounters = new LRUCache<string, number[]>({ max: 10_000 });

// FIX-RL: атомарный инкремент + установка TTL одним round-trip. Раньше это
// были две отдельные команды (INCR, затем EXPIRE только при current===1):
// если процесс падал/таймаутил между ними — ключ оставался БЕЗ времени жизни
// и держал лимит вечно. Lua выполняется в Redis атомарно; вдобавок здесь
// восстанавливаем TTL, если он по какой-то причине был потерян (PTTL < 0).
const INCR_EXPIRE_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 or redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return current
`;

function buildResponse(limit: number, windowMs: number): NextResponse {
  return NextResponse.json(
    { error: "Слишком много запросов. Попробуйте позже." },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil(windowMs / 1000)),
        "X-RateLimit-Limit": String(limit),
        "X-RateLimit-Remaining": "0",
      },
    }
  );
}

async function rateLimitRedis(
  cacheKey: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  try {
    if (redis.status !== "ready") throw new Error("not connected");
    const current = Number(
      await redis.eval(INCR_EXPIRE_LUA, 1, cacheKey, String(windowMs))
    );
    return current > limit;
  } catch {
    return false;
  }
}

function rateLimitMemory(cacheKey: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const windowStart = now - windowMs;
  const timestamps = (memoryCounters.get(cacheKey) ?? []).filter((t) => t > windowStart);
  timestamps.push(now);
  memoryCounters.set(cacheKey, timestamps);
  return timestamps.length > limit;
}

export async function rateLimit(
  req: NextRequest,
  key: string,
  { limit, windowMs }: RateLimitOptions
): Promise<NextResponse | null> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  const cacheKey = `rl:${key}:${ip}`;

  const redisResult = await rateLimitRedis(cacheKey, limit, windowMs);
  // Use Redis if available (returned a definitive answer), otherwise fall back to in-memory
  const exceeded = redis.status === "ready"
    ? redisResult
    : rateLimitMemory(cacheKey, limit, windowMs);

  return exceeded ? buildResponse(limit, windowMs) : null;
}
