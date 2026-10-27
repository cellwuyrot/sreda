import { createHmac } from "node:crypto";
/** coturn REST API credentials: expiry:user and base64 HMAC-SHA1. */
export function ephemeralTurnCredential(userId: string, secret: string, now = Date.now(), ttlSeconds = 3600) {
  const ttl = Math.min(3600, Math.max(60, ttlSeconds));
  const expiresAt = Math.floor(now / 1000) + ttl;
  const username = `${expiresAt}:${userId}`;
  return { username, credential: createHmac("sha1", secret).update(username).digest("base64"), expiresAt };
}
