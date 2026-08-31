/**
 * Догрузка полного списка участников сообщества страницами (клиентская часть).
 *
 * Снимок сообщества отдаёт только первую страницу участников, но нескольким
 * экранам полный список нужен честно: автодополнение упоминаний в поле ввода,
 * выбор исполнителя задачи и меню участника по правому клику (ему нужны id
 * записи участника и его теги для любого автора сообщения — не только для тех,
 * кто попал в первую страницу). Ломать их постраничностью нельзя, поэтому они
 * добирают список сами: страницами по 200 и без тяжёлых полей.
 */

export interface FetchedGroupMember {
  id: string;
  role: string;
  user: {
    id: string;
    name: string | null;
    username?: string | null;
    avatar?: string | null;
    lastSeen?: string | null;
  };
  tags?: { role?: { id: string } }[];
}

const PAGE = 200;
/** Предохранитель от бесконечного цикла, если сервер вернёт неожидаемый ответ. */
const MAX_PAGES = 100;

export async function fetchAllGroupMembers(groupId: string): Promise<FetchedGroupMember[]> {
  const all: FetchedGroupMember[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({ take: String(PAGE) });
    if (cursor) qs.set("cursor", cursor);
    const res = await fetch(`/api/groups/${groupId}/members?${qs.toString()}`);
    if (!res.ok) break;
    const data: { members?: FetchedGroupMember[]; hasMore?: boolean; nextCursor?: string | null } = await res.json();
    const chunk = data.members ?? [];
    all.push(...chunk);
    if (!data.hasMore || !data.nextCursor || chunk.length === 0) break;
    cursor = data.nextCursor;
  }

  return all;
}
