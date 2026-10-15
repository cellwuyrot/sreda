import prisma from "./prisma";
import { hasPremium } from "./premium";
import { hasActiveVpnPlan } from "./vpnPlan";
import {
  validateUsername,
  usernameCooldownLeftMs,
  formatCooldownLeft,
  USERNAME_COOLDOWN_DAYS,
} from "./username";

export const TZ_ID_API_SCOPES = [
  "roles:read",
  "contact:read",
  "subscriptions:read",
  "subscriptions:write",
  "notifications:write",
] as const;
export const TZ_ID_SCOPE_LABELS: Record<string, string> = {
  openid: "Постоянный идентификатор TZ ID",
  profile: "Имя, ник и аватар",
  email: "Email и статус подтверждения",
  offline_access: "Продление доступа",
  "roles:read": "Чтение собственной роли только в этом проекте",
  "contact:read": "Необязательный контактный адрес",
  "subscriptions:read": "Список и сроки подписок (без платёжных данных)",
  "subscriptions:write": "Обновление подписок только этого проекта",
  "notifications:write": "Отправка уведомлений только от этого проекта",
};
export class HubError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function textField(
  value: unknown,
  label: string,
  max: number,
  min = 1,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw new HubError(`${label}: от ${min} до ${max} символов`);
  return value.trim();
}
export function contactAddress(value: unknown): string | null {
  if (value === null || value === "") return null;
  return textField(value, "Контактный адрес", 500);
}
export function projectUrl(value: unknown, origins: string[]): string | null {
  if (value === undefined || value === null || value === "") return null;
  const raw = textField(value, "Ссылка", 2048);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HubError("Некорректная ссылка");
  }
  if (
    !origins.includes(u.origin) ||
    u.username ||
    u.password ||
    (u.protocol !== "https:" &&
      !(
        process.env.TZ_ID_DEV_ALLOW_HTTP === "1" &&
        u.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(u.hostname)
      ))
  )
    throw new HubError(
      "Ссылка должна вести на зарегистрированный сайт проекта",
    );
  return u.href;
}
export function projectSubscription(input: Record<string, unknown>) {
  const externalId = textField(input.externalId, "Идентификатор подписки", 100);
  const title = textField(input.title, "Название подписки", 100);
  if (!["active", "canceled", "expired"].includes(String(input.status)))
    throw new HubError("Некорректный статус подписки");
  let expiresAt: Date | null = null;
  if (input.expiresAt !== null && input.expiresAt !== undefined) {
    if (
      typeof input.expiresAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T/.test(input.expiresAt)
    )
      throw new HubError("Срок: ISO 8601 или null");
    expiresAt = new Date(input.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()))
      throw new HubError("Некорректный срок подписки");
  }
  return { externalId, title, status: String(input.status), expiresAt };
}
export async function identityPatch(
  userId: string,
  input: Record<string, unknown>,
) {
  const data: {
    name?: string;
    username?: string;
    usernameChangedAt?: Date;
    contactAddress?: string | null;
  } = {};
  if (input.name !== undefined) data.name = textField(input.name, "Имя", 50, 2);
  if (input.contactAddress !== undefined)
    data.contactAddress = contactAddress(input.contactAddress);
  if (input.username !== undefined) {
    const result = validateUsername(input.username);
    if (!result.ok) throw new HubError(result.error);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        username: true,
        usernameChangedAt: true,
        isPremium: true,
        role: true,
      },
    });
    if (!user) throw new HubError("Пользователь не найден", 404);
    if (user.username !== result.value) {
      if (!/[0-9]/.test(result.value) && !hasPremium(user))
        throw new HubError(
          "Юзернейм без цифр доступен только Premium-пользователям",
          403,
        );
      const left = usernameCooldownLeftMs(user.usernameChangedAt);
      if (left > 0)
        throw new HubError(
          `Ник можно менять раз в ${USERNAME_COOLDOWN_DAYS} дней — ${formatCooldownLeft(left)}`,
          429,
        );
      const taken = await prisma.user.findUnique({
        where: { username: result.value },
        select: { id: true },
      });
      if (taken && taken.id !== userId)
        throw new HubError("Юзернейм уже занят", 409);
      data.username = result.value;
      data.usernameChangedAt = new Date();
    }
  }
  return data;
}
export async function hubSubscriptions(userId: string) {
  const [user, premium, subscriptions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        isPremium: true,
        role: true,
        vpnAccess: true,
        vpnAccessUntil: true,
      },
    }),
    prisma.premiumSubscription.findFirst({
      where: { userId, status: "active" },
      orderBy: [{ expiresAt: "desc" }, { startedAt: "desc" }],
      select: { expiresAt: true, plan: true },
    }),
    prisma.tzIdProjectSubscription.findMany({
      where: { userId },
      include: { client: { select: { name: true, enabled: true } } },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  ]);
  const premiumActive =
    hasPremium(user) && (!premium?.expiresAt || premium.expiresAt > new Date());
  return [
    {
      id: "trioz-premium",
      projectId: "trioz",
      projectName: "TrioZ",
      title: "Premium",
      status: premiumActive ? "active" : "inactive",
      expiresAt: premium?.expiresAt ?? null,
      source: "trioz",
      projectEnabled: true,
    },
    {
      id: "trioz-vpn",
      projectId: "trioz",
      projectName: "TrioZ",
      title: premiumActive
        ? "TZ.Connect VPN · доступ через Premium"
        : "TZ.Connect VPN",
      status: hasActiveVpnPlan(user) || premiumActive ? "active" : "inactive",
      expiresAt: hasActiveVpnPlan(user)
        ? (user?.vpnAccessUntil ?? null)
        : premiumActive
          ? (premium?.expiresAt ?? null)
          : null,
      source: "trioz",
      projectEnabled: true,
    },
    ...subscriptions.map((row) => ({
      id: row.id,
      projectId: row.clientId,
      projectName: row.client.name,
      title: row.title,
      status:
        row.status === "active" && row.expiresAt && row.expiresAt <= new Date()
          ? "expired"
          : row.status,
      expiresAt: row.expiresAt,
      source: "external",
      projectEnabled: row.client.enabled,
    })),
  ];
}
export async function hubSnapshot(userId: string) {
  const [
    profile,
    subscriptions,
    grants,
    notifications,
    preferences,
    localNotifications,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        username: true,
        avatar: true,
        email: true,
        emailVerified: true,
        contactAddress: true,
      },
    }),
    hubSubscriptions(userId),
    prisma.tzIdAuthorization.findMany({
      where: {
        userId,
        revokedAt: null,
        client: { enabled: true },
        session: { active: true, expiresAt: { gt: new Date() } },
      },
      include: { client: { select: { id: true, name: true } } },
      orderBy: { lastUsedAt: "desc" },
      take: 500,
    }),
    prisma.tzIdProjectNotification.findMany({
      where: { userId },
      include: { client: { select: { name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    }),
    prisma.tzIdNotificationPreference.findMany({ where: { userId } }),
    prisma.notification.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        body: true,
        link: true,
        read: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    }),
  ]);
  const apps = new Map<
    string,
    {
      id: string;
      name: string;
      scopes: string[];
      notificationsEnabled: boolean;
    }
  >();
  for (const g of grants) {
    const current = apps.get(g.clientId);
    const scopes = [
      ...new Set([...(current?.scopes ?? []), ...g.scopes.split(" ")]),
    ];
    apps.set(g.clientId, {
      ...g.client,
      scopes,
      notificationsEnabled:
        preferences.find((p) => p.clientId === g.clientId)?.enabled ?? true,
    });
  }
  const origin =
    process.env.TZ_ID_WEB_ORIGIN ||
    process.env.NEXTAUTH_URL ||
    "https://trioz.ru";
  const localLink = (link: string | null) => {
    if (!link) return null;
    try {
      const u = new URL(link, origin);
      return u.origin === new URL(origin).origin &&
        ["https:", "http:"].includes(u.protocol)
        ? u.href
        : null;
    } catch {
      return null;
    }
  };
  const notices = [
    ...notifications.map((n) => ({
      id: n.id,
      projectId: n.clientId,
      projectName: n.client.name,
      title: n.title,
      body: n.body,
      url: n.url,
      readAt: n.readAt,
      read: Boolean(n.readAt),
      createdAt: n.createdAt,
    })),
    ...localNotifications.map((n) => ({
      id: `trioz:${n.id}`,
      projectId: "trioz",
      projectName: "TrioZ",
      title: n.title,
      body: n.body || "",
      url: localLink(n.link),
      readAt: null,
      read: n.read,
      createdAt: n.createdAt,
    })),
  ]
    .sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() ||
        b.id.localeCompare(a.id),
    )
    .slice(0, 100);
  return {
    profile,
    subscriptions,
    applications: [...apps.values()],
    notifications: notices,
    twoFactor: { available: false, enabled: false },
  };
}
export async function updateHub(userId: string, body: Record<string, unknown>) {
  if (body.action === "profile") {
    const data = await identityPatch(userId, body);
    try {
      await prisma.user.update({ where: { id: userId }, data });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002")
        throw new HubError("Юзернейм уже занят", 409);
      throw e;
    }
  } else if (body.action === "read") {
    const id = textField(body.id, "Уведомление", 100);
    if (id.startsWith("trioz:"))
      await prisma.notification.updateMany({
        where: { id: id.slice(6), userId, read: false },
        data: { read: true },
      });
    else
      await prisma.tzIdProjectNotification.updateMany({
        where: { id, userId, readAt: null },
        data: { readAt: new Date() },
      });
  } else if (body.action === "notifications") {
    const clientId = textField(body.clientId, "Проект", 100);
    if (typeof body.enabled !== "boolean")
      throw new HubError("Укажите состояние уведомлений");
    const grant = await prisma.tzIdAuthorization.findFirst({
      where: {
        userId,
        clientId,
        revokedAt: null,
        client: { enabled: true },
        session: { active: true, expiresAt: { gt: new Date() } },
      },
    });
    if (!grant) throw new HubError("Проект не подключён", 403);
    await prisma.tzIdNotificationPreference.upsert({
      where: { userId_clientId: { userId, clientId } },
      create: { userId, clientId, enabled: body.enabled },
      update: { enabled: body.enabled },
    });
  } else if (body.action === "disconnect") {
    const clientId = textField(body.clientId, "Проект", 100);
    await prisma.$transaction(async (tx) => {
      const grants = await tx.tzIdAuthorization.findMany({
        where: { userId, clientId },
        select: { id: true },
      });
      await tx.tzIdAuthorization.updateMany({
        where: { userId, clientId },
        data: { revokedAt: new Date() },
      });
      await tx.tzIdArtifact.deleteMany({
        where: { grantId: { in: grants.map((g) => g.id) } },
      });
      await tx.tzIdNotificationPreference.updateMany({
        where: { userId, clientId },
        data: { enabled: false },
      });
    });
  } else throw new HubError("Неизвестное действие");
}
