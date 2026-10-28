import prisma from "./prisma";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { decryptTzData } from "./tzIdCrypto";
import { liveSession } from "./tzIdSessions";
import { serviceDraft, hubSignatureText } from "./serviceHubPolicy";
export class ServiceHubError extends Error { constructor(message: string, public status = 400) { super(message); } }
type Context = { clientId: string; actorId: string; global: boolean; machine?: boolean };
export async function bridgeContext(headers: Headers, body: string, input: Record<string, unknown>): Promise<Context> {
  if (process.env.SERVICE_HUB_ENABLED !== "1") throw new ServiceHubError("Общий каталог ещё не включён владельцем", 503);
  const clientId = headers.get("x-service-client") || "", stamp = headers.get("x-service-time") || "", nonce = headers.get("x-service-nonce") || "", signature = headers.get("x-service-signature") || "";
  if (!/^\d{13}$/.test(stamp) || Math.abs(Date.now() - Number(stamp)) > 60000 || !/^[a-f0-9-]{36}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature) || clientId.length > 100) throw new ServiceHubError("Неверная подпись запроса", 401);
  const client = await prisma.tzIdClient.findFirst({ where: { id: clientId, enabled: true } });
  if (!client) throw new ServiceHubError("Приложение отключено", 403);
  const meta = decryptTzData<{ client_secret?: string; scope?: string; token_endpoint_auth_method: string }>(client.metadata);
  if (!meta.client_secret || meta.token_endpoint_auth_method === "none") throw new ServiceHubError("Нужен серверный клиент", 403);
  const expected = createHmac("sha256", meta.client_secret).update(hubSignatureText(clientId, stamp, nonce, body)).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw new ServiceHubError("Неверная подпись запроса", 401);
  const scope = ["fulfill", "eligibility", "deliveryStatus"].includes(String(input.action)) ? "services:fulfill" : "services:manage";
  if (!meta.scope?.split(" ").includes(scope)) throw new ServiceHubError("В настройках TZ ID не разрешена интеграция услуг", 403);
  try { await prisma.tzBridgeNonce.create({ data: { id: `${clientId}:${nonce}`, expiresAt: new Date(Date.now() + 120000) } }); } catch { throw new ServiceHubError("Повторный запрос отклонён", 409); }
  if (input.action === "catalog" || input.action === "fulfill" || input.action === "eligibility" || input.action === "deliveryStatus") return { clientId, actorId: "billing-worker", global: false, machine: true };
  const proof = headers.get("x-service-actor-token") || "";
  if (!proof || proof.length > 4096) throw new ServiceHubError("Повторите вход через TZ ID", 401);
  const artifact = await prisma.tzIdArtifact.findUnique({ where: { key: createHash("sha256").update(`AccessToken:${proof}`).digest("hex") } });
  if (!artifact || artifact.expiresAt <= new Date()) throw new ServiceHubError("Сеанс TZ ID истёк", 401);
  const token = decryptTzData<{ accountId: string; clientId: string; grantId: string }>(artifact.payload);
  const grant = await prisma.tzIdAuthorization.findUnique({ where: { id: token.grantId } });
  if (token.clientId !== clientId || !token.accountId || !grant || grant.revokedAt || grant.clientId !== clientId || grant.userId !== token.accountId || !await liveSession(grant.userId, grant.sessionId)) throw new ServiceHubError("Сеанс отозван", 403);
  return actorContext(token.accountId, clientId, false);
}
export async function actorContext(actorId: string, clientId: string, allowGlobal = true): Promise<Context> {
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true, isDeleted: true, banned: true, bannedUntil: true } });
  if (!actor || actor.isDeleted || (actor.banned && (!actor.bannedUntil || actor.bannedUntil > new Date()))) throw new ServiceHubError("Нет доступа", 403);
  const global = allowGlobal && actor.role === "ADMIN";
  const client = await prisma.tzIdClient.findFirst({ where: { id: clientId, enabled: true } });
  if (!client) throw new ServiceHubError("Проект отключён", 403);
  const role = await prisma.tzIdProjectRole.findUnique({ where: { clientId_userId: { clientId, userId: actorId } } });
  if (!global && (!role || role.revokedAt || role.role !== "ADMIN")) throw new ServiceHubError("Нет прав администратора этого проекта", 403);
  return { actorId, clientId, global };
}
export async function managedAction(ctx: Context, input: Record<string, unknown>) {
  const { clientId, actorId } = ctx;
  if (input.action === "catalog") return { services: await prisma.tzManagedService.findMany({ where: { clientId, published: true }, orderBy: { title: "asc" } }) };
  if (input.action === "eligibility") { if (!ctx.machine) throw new ServiceHubError("Нет доступа", 403); const user = await prisma.user.findUnique({ where: { id: String(input.subject) }, select: { isDeleted: true, banned: true, bannedUntil: true } }); return { allowed: !!user && !user.isDeleted && !(user.banned && (!user.bannedUntil || user.bannedUntil > new Date())) }; }
  if (input.action === "deliveryStatus") {
    if (!ctx.machine || !Array.isArray(input.externalIds) || input.externalIds.length>100 || input.externalIds.some(id=>typeof id!=="string" || id.length>100)) throw new ServiceHubError("Неверные параметры сверки",400);
    return {connections:await prisma.tzManagedConnection.findMany({where:{clientId,externalId:{in:input.externalIds as string[]}},select:{externalId:true,version:true,status:true,manualState:true}})};
  }
  if (input.action === "list") return { services: await prisma.tzManagedService.findMany({ where: { clientId }, orderBy: { createdAt: "desc" } }), members: await prisma.tzIdProjectRole.findMany({ where: { clientId, revokedAt: null }, include: { user: { select: { name: true, username: true } } } }), connections: await prisma.tzManagedConnection.findMany({ where: { clientId }, orderBy: { updatedAt: "desc" }, take: 200 }), global: ctx.global };
  if (input.action === "save") {
    if (ctx.machine) throw new ServiceHubError("Нет доступа", 403);
    let draft; try { draft = serviceDraft(input.service as Record<string, unknown>); } catch (e) { throw new ServiceHubError(e instanceof Error ? e.message : "Проверьте данные услуги"); }
    const id = typeof input.id === "string" ? input.id : "";
    return prisma.$transaction(async tx => {
      const current = id ? await tx.tzManagedService.findFirst({ where: { id, clientId } }) : null;
      if (id && !current) throw new ServiceHubError("Услуга не найдена", 404);
      if (!ctx.global && draft.accessKind !== (current?.accessKind || "MANUAL")) throw new ServiceHubError("Назначить автоматическое право Premium/VPN может только владелец TrioZ", 403);
      if (current && current.accessKind !== draft.accessKind && await tx.tzManagedConnection.count({ where: { serviceId: current.id } })) throw new ServiceHubError("Тип исполнения нельзя менять после появления подключений. Создайте новую услугу.");
      const data = { ...draft, prices: JSON.stringify(draft.prices), methods: JSON.stringify(draft.methods) };
      if (current) { const result = await tx.tzManagedService.updateMany({ where: { id, clientId, revision: Number(input.revision) }, data: { ...data, revision: { increment: 1 } } }); if (!result.count) throw new ServiceHubError("Услуга уже изменена. Обновите список", 409); }
      else await tx.tzManagedService.create({ data: { ...data, clientId } });
      await tx.tzServiceAudit.create({ data: { clientId, actorId, action: "service.save", details: JSON.stringify({ id, title: draft.title }) } });
      return { ok: true };
    });
  }
  if (input.action === "admin") {
    if (ctx.machine || typeof input.subject !== "string" || input.subject.length > 100 || typeof input.enabled !== "boolean") throw new ServiceHubError("Укажите TZ ID пользователя и действие");
    const subject = input.subject, enabled = input.enabled;
    const client = await prisma.tzIdClient.findUniqueOrThrow({ where: { id: clientId } });
    if (!decryptTzData<{ scope?: string }>(client.metadata).scope?.split(" ").includes("roles:read")) throw new ServiceHubError("Сначала разрешите проверку прав проекта в настройках приложения TZ ID", 409);
    return prisma.$transaction(async tx => {
      const target = await tx.user.findFirst({ where: { id: subject, isDeleted: false } }); if (!target) throw new ServiceHubError("Пользователь TZ ID не найден", 404);
      if (!enabled && !ctx.global && await tx.tzIdProjectRole.count({ where: { clientId, revokedAt: null } }) <= 1) throw new ServiceHubError("Нельзя удалить последнего администратора проекта");
      await tx.tzIdProjectRole.upsert({ where: { clientId_userId: { clientId, userId: subject } }, create: { clientId, userId: subject, role: "ADMIN", revokedAt: enabled ? null : new Date() }, update: { role: "ADMIN", revokedAt: enabled ? null : new Date() } });
      await tx.tzServiceAudit.create({ data: { clientId, actorId, action: enabled ? "admin.grant" : "admin.revoke", details: subject } }); return { ok: true };
    }, { isolationLevel: "Serializable" });
  }
  if (input.action === "fulfill") {
    if (!ctx.machine) throw new ServiceHubError("Требуется серверная интеграция", 403);
    return fulfill(ctx, input);
  }
  if (input.action === "complete") {
    const connection = await prisma.tzManagedConnection.findFirst({ where: { id: String(input.id), clientId, accessKind: "MANUAL" } });
    if (!connection || !["ACTIVATION_PENDING", "DEACTIVATION_PENDING"].includes(connection.manualState)) throw new ServiceHubError("Задача не найдена");
    await prisma.$transaction(async tx => { const done = await tx.tzManagedConnection.updateMany({ where: { id: connection.id, version: connection.version, manualState: connection.manualState }, data: { manualState: "DONE", status: connection.manualState === "ACTIVATION_PENDING" && connection.paidUntil > new Date() ? "ACTIVE" : "EXPIRED" } }); if (!done.count) throw new ServiceHubError("Задача уже изменилась. Обновите список", 409); await tx.tzServiceAudit.create({ data: { clientId, actorId, action: "manual.complete", details: connection.id } }); }); return { ok: true };
  }
  throw new ServiceHubError("Неизвестное действие");
}
async function fulfill(ctx: Context, input: Record<string, unknown>) {
  const { clientId } = ctx; const subject = String(input.subject || ""), externalId = String(input.externalId || ""); const until = new Date(String(input.paidUntil)); const version = Number(input.version);
  if (!subject || subject.length > 100 || !externalId || externalId.length > 100 || !Number.isSafeInteger(version) || version < 1 || !Number.isFinite(until.getTime()) || until.getTime() > Date.now() + 370 * 86400000 || !["ACTIVE", "EXPIRED"].includes(String(input.status))) throw new ServiceHubError("Неверные параметры доступа");
  return prisma.$transaction(async tx => {
    const service = await tx.tzManagedService.findFirst({ where: { id: String(input.serviceId), clientId } }); if (!service) throw new ServiceHubError("Услуга не найдена", 404);
    if (input.expectedAccessKind !== service.accessKind) throw new ServiceHubError("Тип исполнения услуги изменился. Нужна сверка администратора", 409);
    if (!await tx.user.findFirst({ where: { id: subject, isDeleted: false } })) throw new ServiceHubError("Пользователь не найден", 404);
    const current = await tx.tzManagedConnection.findUnique({ where: { clientId_externalId: { clientId, externalId } } });
    if (current && (current.serviceId !== service.id || current.userId !== subject)) throw new ServiceHubError("Подключение принадлежит другой услуге", 409);
    if (current && current.version >= version) return { ok: true, reused: true, status: current.status };
    const active = input.status === "ACTIVE" && until > new Date(); const manual = service.accessKind === "MANUAL";
    const data = { clientId, userId: subject, serviceId: service.id, externalId, title: service.title, accessKind: service.accessKind, paidUntil: until, version, status: manual && active ? "PENDING" : active ? "ACTIVE" : "EXPIRED", manualState: manual ? (active ? (current?.manualState === "DONE" && current.status === "ACTIVE" ? "DONE" : "ACTIVATION_PENDING") : "DEACTIVATION_PENDING") : "NONE" };
    if (manual && active && data.manualState === "DONE") data.status = "ACTIVE";
    const row = await tx.tzManagedConnection.upsert({ where: { clientId_externalId: { clientId, externalId } }, create: data, update: data });
    if (!manual) await builtinAccess(tx, subject, service.accessKind, row.id, until, active);
    await tx.tzServiceAudit.create({ data: { clientId, actorId: "billing-worker", action: "access.sync", details: JSON.stringify({ id: row.id, version, status: data.status }) } });
    return { ok: true, status: data.status };
  }, { isolationLevel: "Serializable" });
}
async function builtinAccess(tx: Prisma.TransactionClient, userId: string, kind: string, connectionId: string, until: Date, active: boolean) {
  const id = `managed-${connectionId}`; const isPremium = kind === "PREMIUM";
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  const model = (isPremium ? tx.premiumSubscription : tx.vpnSubscription) as typeof tx.premiumSubscription;
  // Preserve legacy/manual rights with no ledger entry, instead of erasing them when a managed plan ends.
  const other = await model.findFirst({ where: { userId } });
  const legacy = isPremium ? user.isPremium : (user.vpnAccess && (!user.vpnAccessUntil || user.vpnAccessUntil > new Date()));
  if (active && legacy && !other) await model.upsert({ where: { id: `legacy-${kind}-${userId}` }, create: { id: `legacy-${kind}-${userId}`, userId, plan: "lifetime", paymentMethod: "manual", status: "active", expiresAt: isPremium ? null : user.vpnAccessUntil, note: "Сохранено ранее выданное право до подключения общего каталога" }, update: {} });
  const ledger = { userId, plan: "managed", paymentMethod: "business", status: active ? "active" : "expired", expiresAt: until, reference: connectionId };
  await model.upsert({ where: { id }, create: { id, ...ledger }, update: ledger });
  const remaining = await model.findMany({ where: { userId, status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { expiresAt: true } });
  const unlimited = remaining.some(r => r.expiresAt === null); const max = remaining.reduce<Date | null>((acc, r) => r.expiresAt && (!acc || r.expiresAt > acc) ? r.expiresAt : acc, null);
  await tx.user.update({ where: { id: userId }, data: isPremium ? { isPremium: remaining.length > 0 } : { vpnAccess: remaining.length > 0, vpnAccessUntil: unlimited ? null : max } });
}
export async function expireManagedServices() {
  await prisma.tzBridgeNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const rows = await prisma.tzManagedConnection.findMany({ where: { paidUntil: { lte: new Date() }, status: { in: ["ACTIVE", "PENDING"] } }, take: 200 });
  for (const row of rows) await prisma.$transaction(async tx => {
    const lock = await tx.tzManagedConnection.updateMany({ where: { id: row.id, version: row.version, paidUntil: { lte: new Date() }, status: { in: ["ACTIVE", "PENDING"] } }, data: { status: "EXPIRED", manualState: row.accessKind === "MANUAL" ? "DEACTIVATION_PENDING" : "NONE" } });
    if (lock.count && row.accessKind !== "MANUAL") await builtinAccess(tx, row.userId, row.accessKind, row.id, row.paidUntil, false);
  });
}
