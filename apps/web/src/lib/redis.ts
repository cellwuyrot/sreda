import Redis from "ioredis";

const globalForRedis = globalThis as unknown as { redis?: Redis };

function createRedisClient(): Redis {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  return new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 10) return null;
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
  });
}

export const redis: Redis = globalForRedis.redis ?? createRedisClient();

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}

export async function connectRedis(): Promise<boolean> {
  try {
    if (redis.status === "ready") return true;
    // FIX-REDIS: ioredis бросает исключение, если connect() вызвать в статусе
    // connecting/connect/ready. Раньше повторный или гонящийся вызов
    // connectRedis (а также вызов при уже идущем lazy-подключении) валился в
    // catch и печатал ложное «Connection failed». Дёргаем connect() только из
    // «спящих» статусов, иначе возвращаем текущее состояние без исключения.
    if (redis.status === "wait" || redis.status === "end") {
      await redis.connect();
    }
    // FIX-TS: после раннего return выше TS сужает тип redis.status (исключая
    // «ready») и НЕ сбрасывает сужение после await connect() — прямое сравнение
    // даёт TS2367 «no overlap» и валит сборку. Читаем статус заново в
    // переменную с широким типом.
    const statusAfter: string = redis.status;
    return statusAfter === "ready";
  } catch {
    console.warn("[Redis] Connection failed, falling back to in-memory");
    return false;
  }
}
