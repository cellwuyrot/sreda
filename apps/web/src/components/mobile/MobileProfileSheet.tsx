"use client";

import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import BottomSheet from "@/components/mobile/BottomSheet";
import { profileMenuEntries } from "@/lib/profileMenu";
import { unregisterShellPushDevice } from "@/hooks/usePushDevice";

/**
 * MOBILE-PROFILE: своё меню человека на телефоне.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * На телефоне верхняя панель скрыта, а внутри мессенджера её и не должно быть.
 * Из-за этого в приложении не было НИ профиля, НИ центра уведомлений, НИ рабочей
 * среды: попасть туда было неоткуда. У партнёра не было личного кабинета, у
 * редактора и администратора — их разделов. Вместо всего этого рядом с
 * «Присоединиться» стояла кнопка «Друзья», которая повторяла раздел из нижней
 * навигации, то есть занимала место и не давала ничего.
 *
 * Состав меню зависит от роли и живёт в `lib/profileMenu` — там же тесты. Здесь
 * только показ: лист снизу, крупные строки под палец, переход и выход.
 */
export default function MobileProfileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { data: session } = useSession();
  const user = session?.user as { name?: string | null; username?: string | null; role?: string | null } | undefined;
  const entries = profileMenuEntries(user?.role);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <BottomSheet open={open} onClose={onClose} height="auto" title={user?.name || "Профиль"}>
      <div className="pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
        {user?.username && (
          <p className="px-4 pb-3 text-xs text-neutral-500 dark:text-gray-400">@{user.username}</p>
        )}

        <div className="flex flex-col">
          {entries.map((entry) => (
            <button
              key={entry.href}
              onClick={() => go(entry.href)}
              className="min-h-[56px] px-4 py-3 text-left border-t border-neutral-200 dark:border-white/5 active:bg-neutral-100 dark:active:bg-white/5 transition-colors"
            >
              <span className="block text-sm font-medium text-neutral-900 dark:text-white">{entry.label}</span>
              <span className="mt-0.5 block text-xs text-neutral-500 dark:text-gray-400">{entry.hint}</span>
            </button>
          ))}

          <button
            onClick={() => {
              /* PUSH: снимаем устройство до выхода — иначе уведомления продолжат
                 приходить прежнему владельцу на этот телефон. */
              void unregisterShellPushDevice().finally(() => signOut());
            }}
            className="min-h-[56px] px-4 py-3 text-left border-t border-neutral-200 dark:border-white/5 text-sm font-medium text-red-500 active:bg-red-50 dark:active:bg-red-500/5 transition-colors"
          >
            Выйти из аккаунта
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
