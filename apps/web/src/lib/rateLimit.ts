import { LRUCache } from "lru-cache";
import { NextRequest, NextResponse } from "next/server";
import { redis } from "./redis";
import { clientIpOf } from "./clientIp";

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

/**
 * FIX-SEC: `null` означает «Redis не ответил», а НЕ «лимит не превышен».
 *
 * Прежняя версия на любой ошибке возвращала false, а вызывающий доверял этому
 * ответу, если соединение числилось «ready». Таймаут, NOSCRIPT или нехватка
 * памяти в Redis молча ОТКЛЮЧАЛИ лимит целиком — вместо того чтобы перевести
 * счёт в память процесса. Теперь неопределённость выражена отдельным значением,
 * и запасной счётчик включается в том числе при живом, но сбойном Redis.
 */
async function rateLimitRedis(
  cacheKey: string,
  limit: number,
  windowMs: number
): Promise<boolean | null> {
  if (redis.status !== "ready") return null;
  try {
    const current = Number(
      await redis.eval(INCR_EXPIRE_LUA, 1, cacheKey, String(windowMs))
    );
    if (!Number.isFinite(current)) return null;
    return current > limit;
  } catch {
    return null;
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

/**
 * Счётчик по произвольному ключу — для мест, где нет NextRequest (например
 * проверка пароля в NextAuth: там заголовки приходят простым объектом).
 */
export async function isRateLimited(
  key: string,
  identifier: string | null | undefined,
  { limit, windowMs }: RateLimitOptions
): Promise<boolean> {
  const cacheKey = `rl:${key}:${identifier || "unknown"}`;
  const redisResult = await rateLimitRedis(cacheKey, limit, windowMs);
  /* Redis не ответил — считаем в памяти процесса. Это слабее (счёт у каждого
     инстанса свой), но это ЕСТЬ лимит, а не его отсутствие. */
  return redisResult ?? rateLimitMemory(cacheKey, limit, windowMs);
}

export async function rateLimit(
  req: NextRequest,
  key: string,
  { limit, windowMs }: RateLimitOptions
): Promise<NextResponse | null> {
  /* FIX-SEC: адрес берём из доверенного hop, а не из первого значения
     X-Forwarded-For, которое присылает сам клиент (см. lib/clientIp.ts). */
  const ip = clientIpOf(req) || "unknown";
  const exceeded = await isRateLimited(key, ip, { limit, windowMs });
  return exceeded ? buildResponse(limit, windowMs) : null;
}
