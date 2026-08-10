// TZ.Connect — серверный presence-хелпер.
// Отвечает на вопрос: «смотрит ли пользователь прямо сейчас этот канал?»
// Использует функцию, устанавливаемую в server.ts (см. PATCHES2.md, патч 2).

export async function isUserViewingChannel(
  userId: string,
  channelId: string
): Promise<boolean> {
  const helper = (globalThis as Record<string, unknown>).__isUserInChannel as
    | ((userId: string, channelId: string) => Promise<boolean>)
    | undefined;
  if (!helper) return false;
  try {
    return await helper(userId, channelId);
  } catch {
    return false;
  }
}
