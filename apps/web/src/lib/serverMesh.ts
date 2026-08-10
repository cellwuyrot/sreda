import { createHash, randomBytes, timingSafeEqual } from "crypto";
import prisma from "@/lib/prisma";

/**
 * SERVER-MESH: связка главного сервера с дочерними узлами.
 *
 * Главный сервер — тот, где работает это приложение. Дочерние узлы (медиа,
 * VPN, вычисления) не имеют доступа к базе: они лишь отчитываются о себе по
 * токену агента и в ответ получают адрес главного сервера. Так связка остаётся
 * односторонней — узел знает, кому подчиняется, но не наоборот.
 *
 * Токен агента в открытом виде НЕ хранится: в базе только SHA-256. Показать
 * токен можно ровно один раз — при создании узла или перевыпуске.
 */

export const NODE_ROLES = ["MAIN", "CHILD"] as const;
/* BUILD добавлен вместе со сборкой приложений на сервере: агент сборки
   опознаётся тем же токеном, что и агент VPN-узла. Физически он обычно живёт на
   главном сервере, но запись всё равно дочерняя — она описывает АГЕНТА, а не
   машину, и благодаря этому сборку можно перенести на отдельный сервер, не
   меняя кода. */
export const NODE_KINDS = ["APP", "MEDIA", "VPN", "COMPUTE", "STORAGE", "BUILD"] as const;

export type NodeRole = (typeof NODE_ROLES)[number];
export type NodeKind = (typeof NODE_KINDS)[number];

/** Узел считается на связи, если отчитался за последние две минуты. */
export const NODE_ONLINE_WINDOW_MS = 2 * 60 * 1000;

export function isNodeRole(value: unknown): value is NodeRole {
  return typeof value === "string" && (NODE_ROLES as readonly string[]).includes(value);
}

export function isNodeKind(value: unknown): value is NodeKind {
  return typeof value === "string" && (NODE_KINDS as readonly string[]).includes(value);
}

/** Новый токен агента. Возвращаем и сам токен, и его хеш для хранения. */
export function issueAgentToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashAgentToken(token) };
}

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Найти узел по токену из заголовка Authorization.
 *
 * Сравнение хешей идёт через timingSafeEqual: длина одинаковая (64 hex-символа),
 * поэтому по времени ответа нельзя подбирать токен посимвольно.
 */
export async function findNodeByToken(authorization: string | null) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (!token || token.length > 200) return null;

  const expected = Buffer.from(hashAgentToken(token), "utf8");
  const candidates = await prisma.serverNode.findMany({
    where: { enabled: true, tokenHash: { not: null } },
    select: { id: true, name: true, role: true, kind: true, url: true, region: true, tokenHash: true },
  });

  for (const node of candidates) {
    if (!node.tokenHash) continue;
    const actual = Buffer.from(node.tokenHash, "utf8");
    if (actual.length !== expected.length) continue;
    if (timingSafeEqual(actual, expected)) return node;
  }
  return null;
}

/** Онлайн-статус узла по времени последнего отчёта. */
export function nodeStatus(lastSeenAt: Date | null, enabled: boolean): "online" | "offline" | "disabled" {
  if (!enabled) return "disabled";
  if (!lastSeenAt) return "offline";
  return Date.now() - lastSeenAt.getTime() <= NODE_ONLINE_WINDOW_MS ? "online" : "offline";
}
