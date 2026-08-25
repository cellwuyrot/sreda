"use client";

/* MAIL-WHITELIST: «Настройки ограничений» → «Белые списки».

   На странице сейчас один список — регистрация по почте. Остальные белые
   списки встанут здесь же, каждый своей карточкой. */

import Link from "next/link";
import { useSession } from "next-auth/react";
import EmailWhitelistPanel from "@/components/admin/EmailWhitelistPanel";

export default function AdminWhitelistPage() {
  const { data: session, status } = useSession();

  if (status === "loading") return <div className="p-8 text-neutral-500 dark:text-white/60">Загрузка…</div>;
  if (session?.user?.role !== "ADMIN") return null;

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 pb-12 pt-8">
      <div className="mb-6">
        <Link
          href="/admin/restrictions"
          className="text-sm text-neutral-500 hover:text-neutral-900 dark:text-white/60 dark:hover:text-white"
        >
          ← Настройки ограничений
        </Link>
      </div>

      <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-white">Белые списки</h1>
      <p className="mb-6 text-sm text-neutral-500 dark:text-gray-400">Доступ только тем, кто есть в таблице</p>

      <EmailWhitelistPanel />
    </div>
  );
}
