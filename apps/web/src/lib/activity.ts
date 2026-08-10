/**
 * FIX-ACT: серверные помощники для «активности с ПК».
 *
 * Десктоп-оболочка определяет, чем занят пользователь (по списку процессов),
 * и присылает готовую фразу («Слушает музыку в Spotify») в
 * PUT /api/profile/activity. Активность показывается в статусе профиля только
 * если:
 *   1) пользователь включил чекбокс «Показывать мою активность» (activityEnabled);
 *   2) у него нет ручного кастомного статуса (ручной всегда важнее);
 *   3) активность свежая — обновлялась не позже ACTIVITY_TTL_MS назад
 *      (десктоп шлёт keepalive раз в минуту; закрыл приложение — статус гаснет).
 */

export const ACTIVITY_TTL_MS = 3 * 60 * 1000; // 3 минуты

/** Вернуть текст активности, если она ещё «живая», иначе null. */
export function freshActivity(user: {
  activityStatus?: string | null;
  activityUpdatedAt?: Date | string | null;
}): string | null {
  if (!user.activityStatus || !user.activityUpdatedAt) return null;
  const age = Date.now() - new Date(user.activityUpdatedAt).getTime();
  return age <= ACTIVITY_TTL_MS ? user.activityStatus : null;
}
