import type { IncomingMessage, ServerResponse } from "node:http";
import {
  hubSubscriptions,
  projectSubscription,
  projectUrl,
  textField,
  HubError,
} from "../../web/src/lib/tzIdHub";
import { prisma } from "../../web/src/lib/prisma";
import { decryptTzData } from "../../web/src/lib/tzIdCrypto";
import { isRateLimited } from "../../web/src/lib/rateLimit";
import { bodyOf, json } from "./http";
type ApiToken = { accountId?: string; clientId?: string; scope?: string };
type TokenProvider = {
  AccessToken: { find(token: string): Promise<ApiToken | undefined> };
};
export async function projectApi(
  req: IncomingMessage,
  res: ServerResponse,
  provider: TokenProvider,
  path: string,
) {
  if (!path.startsWith("/api/v1/")) return false;
  try {
    const raw = req.headers.authorization;
    if (!raw?.startsWith("Bearer ") || raw.length > 4096)
      throw new HubError("Требуется access token", 401);
    const token = await provider.AccessToken.find(raw.slice(7));
    if (!token?.accountId || !token.clientId)
      throw new HubError("Токен истёк или отозван", 401);
    if (
      await isRateLimited(
        "tz-id-project-api",
        `${token.clientId}:${token.accountId}`,
        { limit: 120, windowMs: 60_000 },
      )
    )
      throw new HubError("Превышен лимит запросов", 429);
    const client = await prisma.tzIdClient.findFirst({
      where: { id: token.clientId, enabled: true },
    });
    if (!client) throw new HubError("Проект отключён", 403);
    const metadata = decryptTzData<{
      redirect_uris: string[];
      scope?: string;
      token_endpoint_auth_method: string;
    }>(client.metadata);
    const scopes = new Set((token.scope || "").split(" "));
    const allowed = new Set(
      (metadata.scope || "openid profile email").split(" "),
    );
    const requireScope = (scope: string, write = false) => {
      if (
        !scopes.has(scope) ||
        !allowed.has(scope) ||
        (write && metadata.token_endpoint_auth_method === "none")
      )
        throw new HubError("Нет разрешения на эту операцию", 403);
    };
    const userId = token.accountId;
    if (path === "/api/v1/contact" && req.method === "GET") {
      requireScope("contact:read");
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { contactAddress: true },
      });
      json(res, { sub: userId, contactAddress: user?.contactAddress ?? null });
    } else if (path === "/api/v1/subscriptions" && req.method === "GET") {
      requireScope("subscriptions:read");
      json(res, { sub: userId, subscriptions: await hubSubscriptions(userId) });
    } else if (path === "/api/v1/subscriptions" && req.method === "PUT") {
      requireScope("subscriptions:write", true);
      const input = await bodyOf(req);
      if ("userId" in input || "clientId" in input || "sub" in input)
        throw new HubError("Пользователь и проект определяются токеном");
      const data = projectSubscription(input);
      const row = await prisma.tzIdProjectSubscription.upsert({
        where: {
          clientId_userId_externalId: {
            clientId: client.id,
            userId,
            externalId: data.externalId,
          },
        },
        create: { clientId: client.id, userId, ...data },
        update: data,
      });
      json(res, { id: row.id, updatedAt: row.updatedAt });
    } else if (path === "/api/v1/notifications" && req.method === "POST") {
      requireScope("notifications:write", true);
      const input = await bodyOf(req);
      if ("userId" in input || "clientId" in input || "sub" in input)
        throw new HubError("Пользователь и проект определяются токеном");
      const externalId = textField(
        input.externalId,
        "Идентификатор уведомления",
        100,
      );
      const title = textField(input.title, "Заголовок", 150);
      const body = textField(input.body, "Текст", 2000);
      const url = projectUrl(
        input.url,
        metadata.redirect_uris.map((uri) => new URL(uri).origin),
      );
      const preference = await prisma.tzIdNotificationPreference.findUnique({
        where: { userId_clientId: { userId, clientId: client.id } },
      });
      if (preference?.enabled === false) {
        json(res, { accepted: false, reason: "notifications_disabled" });
        return true;
      }
      const existing = await prisma.tzIdProjectNotification.findUnique({
        where: {
          clientId_userId_externalId: {
            clientId: client.id,
            userId,
            externalId,
          },
        },
      });
      if (existing) {
        json(res, { accepted: true, id: existing.id, duplicate: true });
        return true;
      }
      if (
        await isRateLimited(
          "tz-id-notification-write",
          `${client.id}:${userId}`,
          { limit: 30, windowMs: 3600_000 },
        )
      )
        throw new HubError("Превышен лимит уведомлений", 429);
      const row = await prisma.tzIdProjectNotification.upsert({
        where: {
          clientId_userId_externalId: {
            clientId: client.id,
            userId,
            externalId,
          },
        },
        create: { clientId: client.id, userId, externalId, title, body, url },
        update: {},
      });
      json(res, { accepted: true, id: row.id }, 201);
    } else throw new HubError("Метод или маршрут не поддерживается", 404);
  } catch (e) {
    const status = e instanceof HubError ? e.status : 500;
    if (status === 401)
      res.setHeader("WWW-Authenticate", 'Bearer error="invalid_token"');
    json(
      res,
      {
        error:
          e instanceof HubError ? e.message : "Не удалось выполнить запрос",
      },
      status,
    );
  }
  return true;
}
