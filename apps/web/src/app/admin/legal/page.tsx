"use client";

/* UNIFY: раздел «Контент сайта → Правовая информация» больше не редактирует
   текст. Два независимых редактора были причиной пересечения данных:
   админ правил текст здесь, а на /about показывался другой источник.
   Теперь всё редактируется в блоках «О проекте». Старые данные не удалены:
   единый блок сам подтягивает их при первом открытии. */

import Link from "next/link";

export default function AdminLegalRedirectPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div
        id="legal-moved"
        className="rounded-2xl border border-indigo-500/25 bg-indigo-500/[0.07] p-6"
      >
        <h1 className="mb-3 text-xl font-bold text-white">
          Правовая информация переехала в «О проекте»
        </h1>
        <p className="mb-4 text-sm leading-relaxed text-neutral-400">
          Текст соглашения, разделы документа и опубликованные почты теперь
          настраиваются в одном месте — блок «⚖️ Правовая информация» в разделе
          «О проекте». Так данные больше не пересекаются, и всё, что вы ввели,
          сразу видно на странице /about.
        </p>
        <p className="mb-6 text-xs leading-relaxed text-neutral-500">
          Ранее введённый текст не потерян: при первом открытии нового блока
          он подтягивается автоматически.
        </p>
        <Link
          href="/admin/about"
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
        >
          Открыть единый редактор «О проекте»
        </Link>
      </div>
    </div>
  );
}
