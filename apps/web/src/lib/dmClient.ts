import { encryptMessage } from "./e2ee";
/** No plaintext fallback; used by send, retry and edit. */
export async function prepareDmContent(secure: boolean, text: string, privateKey: CryptoKey | null, peer: JsonWebKey | null): Promise<string> {
  if (!secure) return text;
  if (!privateKey || !peer) throw new Error("Нет ключей для защищённой отправки. Сообщение не отправлено.");
  if (!text.trim()) throw new Error("В защищённой переписке пока поддерживается только текст.");
  try { return await encryptMessage(text, privateKey, peer); }
  catch { throw new Error("Не удалось зашифровать сообщение. Оно не отправлено."); }
}
export function mergeDmMessages<T extends { id: string; clientMessageId?: string | null; userId: string; createdAt: string }>(current: T[], incoming: T[]): T[] {
  const result = [...current];
  for (const item of incoming) {
    const index = result.findIndex(m => m.id === item.id || (item.clientMessageId && m.clientMessageId === item.clientMessageId && m.userId === item.userId));
    if (index < 0) result.push(item); else result[index] = { ...result[index], ...item };
  }
  return result.sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
