import { redirect } from "next/navigation";

/**
 * PROFILE-WALL2: старый адрес профиля.
 *
 * Раньше здесь жила отдельная страница — без стены и подписок. После появления
 * полноценного профиля она превратилась в ловушку: мини-карточка в чате, список
 * друзей и упоминания вели сюда, и человек видел старый экран, а новый был
 * доступен только через пункт «Мой профиль».
 *
 * Адрес оставлен живым переадресацией, а не удалён: ссылки вида /user/имя уже
 * разосланы в сообщениях и сохранены в закладках — ломать их нет причины.
 */
export default async function LegacyUserProfileRoute({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  redirect(`/profile/${encodeURIComponent(decodeURIComponent(username))}`);
}
