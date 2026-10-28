import prisma from "./prisma";
import { decryptTzData } from "./tzIdCrypto";
import { BUSINESS_SUBSCRIPTIONS_URL, emptyBusinessOffers, type BusinessOffers } from "./businessSubscriptions";
/** Match the registered Business server client, not a name or a user-controlled payment URL. */
export function isBusinessClientMetadata(meta: { redirect_uris?: unknown; scope?: unknown; client_secret?: unknown; token_endpoint_auth_method?: unknown }): boolean {
  if (typeof meta.client_secret !== "string" || !meta.client_secret || meta.token_endpoint_auth_method === "none") return false;
  if (typeof meta.scope !== "string" || !["services:manage", "services:fulfill"].every(s => (meta.scope as string).split(/\s+/).includes(s))) return false;
  if (!Array.isArray(meta.redirect_uris)) return false;
  return meta.redirect_uris.some(value => {
    if (typeof value !== "string") return false;
    try { const u = new URL(value); return u.origin === "https://business.trioz.ru" && !u.username && !u.password && !u.search && !u.hash && u.pathname === "/api/auth/tz-id/callback"; } catch { return false; }
  });
}
export async function businessSubscriptionOffers(): Promise<BusinessOffers> {
  const offers = emptyBusinessOffers();
  if (process.env.SERVICE_HUB_ENABLED !== "1") return offers;
  const clients = await prisma.tzIdClient.findMany({ where: { enabled: true }, select: { id: true, metadata: true } });
  const ids = clients.filter(c => {
    try { return isBusinessClientMetadata(decryptTzData(c.metadata)); } catch { return false; }
  }).map(c => c.id);
  if (!ids.length) return offers;
  const services = await prisma.tzManagedService.findMany({ where: { clientId: { in: ids }, published: true, accessKind: { in: ["VPN", "PREMIUM"] } }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], select: { accessKind: true, title: true, prices: true, methods: true } });
  for (const service of services) {
    const kind = service.accessKind;
    if ((kind !== "VPN" && kind !== "PREMIUM") || offers[kind]) continue;
    try {
      const raw = JSON.parse(service.prices), methods = JSON.parse(service.methods);
      if (!raw || typeof raw !== "object" || !Array.isArray(methods) || !methods.some(m => ["ONE_TIME", "RECURRING", "INVOICE"].includes(m))) continue;
      const prices = [1, 3, 6, 12].map(months => ({ months, amountMinor: raw[String(months)] as number })).filter(p => Number.isSafeInteger(p.amountMinor) && p.amountMinor > 0);
      if (!prices.length) continue;
      offers[kind] = { kind, title: service.title, href: BUSINESS_SUBSCRIPTIONS_URL, prices };
    } catch { /* A malformed or incomplete service must not advertise a checkout. */ }
  }
  return offers;
}
