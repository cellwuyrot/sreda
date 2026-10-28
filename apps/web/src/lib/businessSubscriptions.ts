/** Payment belongs to Business. Never put account tokens or arbitrary URLs in this handoff. */
export const BUSINESS_SUBSCRIPTIONS_URL = "https://business.trioz.ru/subscriptions";
export type BusinessSubscriptionKind = "VPN" | "PREMIUM";
export type BusinessOffer = { kind: BusinessSubscriptionKind; title: string; href: string; prices: { months: number; amountMinor: number }[] };
export type BusinessOffers = Record<BusinessSubscriptionKind, BusinessOffer | null>;
export function emptyBusinessOffers(): BusinessOffers { return { VPN: null, PREMIUM: null }; }
export function businessPriceLabel(offer: BusinessOffer): string {
  const first = offer.prices[0];
  if (!first) return "Условия и стоимость — в Business";
  const money = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(first.amountMinor / 100);
  return `${money} за ${first.months} мес.`;
}
export function parseBusinessOffers(value: unknown): BusinessOffers {
  if (!value || typeof value !== "object" || !("offers" in value)) throw Error("Некорректный каталог");
  const input = (value as { offers: unknown }).offers;
  if (!input || typeof input !== "object") throw Error("Некорректный каталог");
  const result = emptyBusinessOffers();
  for (const kind of ["VPN", "PREMIUM"] as const) {
    const row = (input as Record<string, unknown>)[kind];
    if (row === null) continue;
    if (!row || typeof row !== "object") throw Error("Некорректное предложение");
    const offer = row as BusinessOffer;
    if (offer.kind !== kind || offer.href !== BUSINESS_SUBSCRIPTIONS_URL || typeof offer.title !== "string" || !Array.isArray(offer.prices) || !offer.prices.length || offer.prices.some(p => !p || ![1, 3, 6, 12].includes(p.months) || !Number.isSafeInteger(p.amountMinor) || p.amountMinor < 1)) throw Error("Некорректное предложение");
    result[kind] = offer;
  }
  return result;
}
