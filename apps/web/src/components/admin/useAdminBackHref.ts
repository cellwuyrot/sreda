"use client";

import { useSession } from "next-auth/react";

/**
 * FIX-EDR2: куда ведёт ссылка «Назад» из раздела админки.
 *
 * Разделы `/admin/users`, `/admin/premium`, `/admin/badges`, `/admin/appeals`,
 * `/admin/projects`, `/admin/broadcast`, `/admin/notifications`, `/admin/ai`,
 * `/admin/logs` и `/admin/services` открыты и администратору, и редактору — именно на них ведут
 * кнопки «Редакторской» (`/editor`). Но ссылка возврата была жёстко зашита на
 * `/admin`, а главная страница админки пускает только ADMIN и отправляет
 * остальных в `/connect`. Из-за этого редактор, нажав «Назад», вылетал из
 * своего рабочего раздела — со стороны выглядело как «не получается перейти
 * по кнопкам».
 *
 * Хук возвращает адрес по роли: редактору — «Редакторская», администратору —
 * админ-панель. Разметку страниц при этом менять не нужно.
 */
export function useAdminBackHref(): string {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  return role === "EDITOR" ? "/editor" : "/admin";
}

/**
 * FIX-EDR2: подпись к ссылке возврата — в тон адресу из {@link useAdminBackHref}.
 * Часть разделов подписывает ссылку текстом («Панель администратора»), и для
 * редактора он вводил в заблуждение.
 */
export function useAdminBackLabel(): string {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  return role === "EDITOR" ? "← Редакторская" : "← Панель администратора";
}
