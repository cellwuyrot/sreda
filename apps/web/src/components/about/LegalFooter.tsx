"use client";

/**
 * Правовой подвал страницы /about.
 *
 * Показывается ВСЕГДА и ровно один раз, в самом конце страницы.
 *
 * Источники текста (дополняют друг друга, см. useLegalContent):
 *   редакция по умолчанию → Контент сайта → Правовая информация
 *   → блок «Правовая информация» из Контент сайта → О проекте (blockOverrides).
 *
 * Текст виден сразу, без аккордеонов и кликов: при первом рендере
 * подставляется редакция по умолчанию, затем она тихо заменяется текстом из
 * админки. Поэтому подвал не бывает пустым ни при каком состоянии базы.
 */

import { useLegalContent } from "./useLegalContent";

type Overrides = Record<string, string> | null | undefined;

export default function LegalFooter({
  blockOverrides,
  siteOverrides,
}: {
  blockOverrides?: Overrides;
  /** Текст «Контент сайта → Правовая информация», если уже загружен. */
  siteOverrides?: Overrides;
} = {}) {
  const content = useLegalContent(blockOverrides, siteOverrides);

  return (
    <section
      id="legal"
      aria-labelledby="legal-heading"
      className="border-t border-indigo-500/10 px-6 py-16 md:px-10 lg:px-16"
    >
      <div className="mx-auto max-w-5xl">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-indigo-400">
          Правовая информация
        </p>

        <h2
          id="legal-heading"
          className="mb-3 text-3xl font-black leading-tight text-white md:text-4xl"
        >
          {content.heading}
        </h2>

        <p className="mb-8 max-w-3xl text-sm leading-relaxed text-neutral-500">
          {content.subheading}
        </p>

        <div className="mb-10 max-w-4xl rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm leading-7 text-neutral-300">
          <p className="whitespace-pre-line">{content.preamble}</p>
        </div>

        <div id="legal-sections" className="space-y-10">
          {content.sections.map((section) => (
            <article key={section.title}>
              <h3 className="mb-3 text-lg font-bold text-white">
                {section.title}
              </h3>

              <div className="max-w-4xl whitespace-pre-line text-sm leading-7 text-neutral-400">
                {section.content}
              </div>
            </article>
          ))}
        </div>

        <div
          id="legal-contacts"
          className="mt-12 grid gap-4 border-t border-indigo-500/10 pt-7 sm:grid-cols-2"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-600">
              Юридические обращения
            </p>

            <a
              href={`mailto:${content.contactEmail}`}
              className="mt-1 inline-block text-sm text-indigo-400 transition-colors hover:text-indigo-300"
            >
              {content.contactEmail}
            </a>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-600">
              Официальный сайт
            </p>

            <a
              href={content.contactUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-sm text-indigo-400 transition-colors hover:text-indigo-300"
            >
              {content.contactUrl}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Ссылки в самом низу страницы. Берёт ту же почту, что и документ выше. */
export function LegalContactLinks({
  blockOverrides,
  siteOverrides,
}: {
  blockOverrides?: Overrides;
  /** Текст «Контент сайта → Правовая информация», если уже загружен с сервера. */
  siteOverrides?: Overrides;
} = {}) {
  const content = useLegalContent(blockOverrides, siteOverrides);

  return (
    <>
      <a href="#legal" className="transition-colors hover:text-indigo-400">
        Правовая информация
      </a>

      <a
        href={`mailto:${content.contactEmail}`}
        className="transition-colors hover:text-indigo-400"
      >
        {content.contactEmail}
      </a>
    </>
  );
}
