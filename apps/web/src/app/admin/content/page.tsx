"use client";

/**
 * Контент сайта — страница-указатель.
 *
 * Блочный редактор страницы /about убран: страница собирается из
 * заголовка, четырёх карточек направлений и аккордеона соглашения.
 * Тексты правятся в двух разделах ниже.
 */

import Link from "next/link";

const TARGETS = [
  {
    href: "/admin/about",
    title: "О проекте",
    text: "Заголовок, подзаголовок, описания четырёх направлений и подпись страницы /about.",
  },
  {
    href: "/admin/legal",
    title: "Правовая информация",
    text: "Пользовательское соглашение: заголовки, преамбула и восемь разделов в аккордеоне на /about.",
  },
];

export default function AdminContentPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-lg font-bold">Контент сайта</h1>
      <p className="mt-2 text-sm text-white/60">
        Страница /about редактируется в двух разделах:
      </p>

      <div className="mt-6 grid gap-4">
        {TARGETS.map((target) => (
          <Link
            key={target.href}
            href={target.href}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-white/25"
          >
            <div className="text-sm font-semibold text-white">{target.title}</div>
            <div className="mt-1 text-xs text-white/60">{target.text}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
