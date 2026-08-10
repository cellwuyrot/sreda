export function timeAgo(date: string | Date | null | undefined): string {
  if (!date) return "давно";
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return "только что";
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `${m} мин. назад`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `${h} ч. назад`;
  }
  const d = Math.floor(diff / 86400);
  if (d === 1) return "вчера";
  return `${d} дн. назад`;
}

/**
 * Сколько живёт отметка присутствия. Значение одно на весь проект: клиент считает
 * по нему «в сети», сервер — кого отдавать в списке присутствия. Разойдись они, и
 * один экран показывал бы человека в сети, а другой — уже нет.
 *
 * 60 секунд, потому что отметка обновляется каждые 30 (см. hooks/useHeartbeat):
 * пропуск одного удара сети статус не рушит.
 */
export const ONLINE_WINDOW_MS = 60_000;

export function isOnline(lastSeen: string | Date | null | undefined): boolean {
  if (!lastSeen) return false;
  const diff = Date.now() - new Date(lastSeen).getTime();
  return diff < ONLINE_WINDOW_MS;
}
