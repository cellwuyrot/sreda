/**
 * Единая выборка участника сообщества для снимка группы
 * (GET /api/groups/[id]) и постраничного списка (GET /api/groups/[id]/members).
 *
 * Держать её в одном месте нужно, чтобы страницы догрузки приходили в том же
 * виде, что первая страница: клиент склеивает их в один список и не должен
 * замечать, откуда пришла строка.
 *
 * Полей ровно столько, сколько читает интерфейс: аватар с подсветкой, имя,
 * ник, присутствие, системная роль, теги и активный тайм-аут. Раньше сюда
 * попадал ещё `user.profileBanner` — баннер профиля лежит в базе как data URL
 * (до ~900 КБ на человека) и в списке участников не показывается, поэтому на
 * большом сообществе он один и давал основной вес ответа.
 */
export const GROUP_MEMBER_SELECT = {
  id: true,
  role: true,
  mutedUntil: true,
  muteReason: true,
  guidedUntil: true,
  /* FIX-SRVSHOW: персональные переопределения для этого сообщества. Без них
     раздел «Профиль на выбранном сервере» писал в базу, но нигде не показывался:
     список участников и карточка брали только общий профиль, и выглядело это как
     «настройки на группу не принимаются». */
  displayName: true,
  avatar: true,
  profileBanner: true,
  user: {
    select: {
      id: true,
      name: true,
      username: true,
      avatar: true,
      role: true,
      lastSeen: true,
      avatarGlowEnabled: true,
      avatarGlowColors: true,
      /* FIX-BANNERWEB: фон профиля вернулся в выборку. Теперь это путь к файлу
         (десятки знаков), а не data URL, из-за которого поле однажды убрали:
         без него карточка участника в вебе оставалась без фона. */
      profileBanner: true,
    },
  },
  tags: {
    select: { role: { select: { id: true, name: true, color: true } } },
  },
} as const;

/**
 * Порядок участников. `joinedAt` — исторический порядок списка; `id` добавлен
 * вторым ключом, иначе у людей с одинаковой датой входа (импорт, сид) порядок
 * между страницами мог бы разъехаться и строки задваивались бы при догрузке.
 *
 * Функция, а не константа: Prisma принимает изменяемый массив, а общий
 * `as const` отдал бы readonly-кортеж и сборка бы не прошла.
 */
export const groupMemberOrder = () => [{ joinedAt: "asc" as const }, { id: "asc" as const }];

/** Размер страницы участников в снимке сообщества. */
export const MEMBERS_PAGE_SIZE = 50;

/**
 * FIX-SRVSHOW: наложить переопределения сообщества на общий профиль.
 *
 * Имя и аватар в ответе уже готовые к показу: клиенту не нужно знать о двух
 * источниках и повторять эту логику в каждом месте. Ник (@username) остаётся
 * единым на всю площадку — иначе упоминания и поиск людей разошлись бы с тем,
 * что написано в карточке.
 */
export function withMemberOverrides<
  T extends {
    displayName?: string | null;
    avatar?: string | null;
    profileBanner?: string | null;
    user: { name: string; avatar: string | null; profileBanner?: string | null };
  },
>(member: T): T {
  return {
    ...member,
    user: {
      ...member.user,
      name: member.displayName ?? member.user.name,
      avatar: member.avatar ?? member.user.avatar,
      profileBanner: member.profileBanner ?? member.user.profileBanner ?? null,
    },
  };
}
