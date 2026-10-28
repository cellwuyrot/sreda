export const PERIODS = [1, 3, 6, 12] as const;
export type ServiceDraft = { title: string; description: string; prices: Record<string, number>; methods: string[]; allowCancel: boolean; published: boolean; accessKind: string };
export function serviceDraft(raw: Record<string, unknown>): ServiceDraft {
  if (!raw || typeof raw !== "object") throw Error("Проверьте данные услуги");
  if (typeof raw.title !== "string" || raw.title.trim().length < 2 || raw.title.length > 120 || typeof raw.description !== "string" || raw.description.length < 10 || raw.description.length > 5000) throw Error("Заполните название и описание услуги");
  if (!raw.prices || typeof raw.prices !== "object" || Array.isArray(raw.prices)) throw Error("Укажите цены за выбранные периоды");
  const prices = raw.prices as Record<string, number>;
  if (!Object.keys(prices).length || Object.entries(prices).some(([k, v]) => !PERIODS.includes(Number(k) as 1) || !Number.isSafeInteger(v) || v < 1 || v > 2_147_483_647)) throw Error("Периоды: 1, 3, 6, 12 месяцев; цена — положительная сумма в копейках");
  if (!Array.isArray(raw.methods) || !raw.methods.length || raw.methods.some(x => !["ONE_TIME", "RECURRING", "INVOICE"].includes(x))) throw Error("Выберите способ оплаты");
  if (typeof raw.allowCancel !== "boolean" || typeof raw.published !== "boolean" || !["MANUAL", "PREMIUM", "VPN"].includes(String(raw.accessKind))) throw Error("Проверьте настройки услуги");
  return { title: raw.title.trim(), description: raw.description.trim(), prices, methods: [...new Set(raw.methods)] as string[], allowCancel: raw.allowCancel, published: raw.published, accessKind: String(raw.accessKind) };
}
export function hubSignatureText(clientId: string, timestamp: string, nonce: string, body: string) { return ["trioz-service-hub-v1", clientId, timestamp, nonce, body].join("\n"); }
