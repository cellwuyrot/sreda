import prisma from "@/lib/prisma";

/**
 * FIX-SRVCHAT: наложить профиль сообщества на авторов сообщений.
 *
 * Имя, аватар и фон мини-профиля можно задать отдельно для каждого сообщества
 * (раздел «Профиль на выбранном сервере»), и хранятся они на участнике, а не
 * на пользователе. Сообщения выбираются по автору, поэтому в чате всегда
 * показывался общий профиль — со стороны это выглядело как «настройки на группу
 * не принимаются».
 *
 * Один запрос на выборку, а не по автору на каждое сообщение: авторов в окне
 * истории десятки, а участников с переопределениями — единицы.
 *
 * Ник (@username) сознательно не переопределяется: он единый на всю площадку,
 * иначе упоминания и поиск людей разошлись бы с тем, что в карточке.
 */
export async function applyMemberOverrides<
  T extends {
    user?: { id: string; name: string; avatar: string | null; profileBanner?: string | null } | null;
  },
>(items: T[], groupId: string | null | undefined): Promise<T[]> {
  if (!groupId || items.length === 0) return items;

  const ids = Array.from(
    new Set(items.map((i) => i.user?.id).filter((v): v is string => typeof v === "string")),
  );
  if (ids.length === 0) return items;

  const rows = await prisma.groupMember.findMany({
    where: { groupId, userId: { in: ids } },
    select: { userId: true, displayName: true, avatar: true, profileBanner: true },
  });
  if (rows.length === 0) return items;

  const byUser = new Map(rows.map((r) => [r.userId, r]));
  for (const item of items) {
    const user = item.user;
    if (!user) continue;
    const over = byUser.get(user.id);
    if (!over) continue;
    if (over.displayName) user.name = over.displayName;
    if (over.avatar) user.avatar = over.avatar;
    /* FIX-BANNERSYNC: если пользователь никогда не заходил на свою страницу
       профиля через веб, resolveProfileBanner ещё не мигрировал баннер из
       GroupMember.profileBanner в User.profileBanner, и сообщения отдают
       user.profileBanner = null. Применяем запасной вариант здесь: баннер
       берётся из первого найденного сообщества, как это делает
       resolveProfileBanner, — поведение идентично странице профиля. */
    if (over.profileBanner) user.profileBanner = over.profileBanner;
  }
  return items;
}
