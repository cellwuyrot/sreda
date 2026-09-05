"use client";

/**
 * Правовая информация в подвале страницы /about.
 *
 * Единственное место на сайте, где показывается пользовательское соглашение.
 * Текст берётся из Админ → Контент сайта → Правовая информация
 * (siteConfig, ключи `content:legal.*`), а при отсутствии переопределений —
 * из редакции по умолчанию в `@/lib/legal`.
 *
 * Важное свойство: компонент никогда не остаётся пустым. Первый рендер,
 * отказ сети, 403, битый JSON — во всех случаях показывается текст из кода.
 * Именно отсутствие такого запасного варианта раньше и давало «пустой подвал».
 */

import { useEffect, useState } from "react";
import { useLegalContent } from "./useLegalContent";

export type LegalFooterProps = {
  /**
   * Готовые настройки из siteConfig (ключи `legal.*`). Если переданы — запрос
   * к `/api/site-content` не выполняется. Удобно для серверного рендера и тестов.
   */
  overrides?: Record<string, string> | null;
  /** Показать полный документ сразу, без клика по кнопке. */
  defaultExpanded?: boolean;
};

export default function LegalFooter({
  overrides,
  defaultExpanded = false,
}: LegalFooterProps = {}) {
  // Текст и почты — из единого источника, того же, что и у колонтитула.
  const content = useLegalContent(overrides);
  const [expanded, setExpanded] = useState(defaultExpanded);

  // По ссылке #legal из подвала документ должен сразу быть раскрытым.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#legal") {
      setExpanded(true);
    }
  }, []);

  return (
    <section
      id="legal"
      aria-labelledby="legal-heading"
      className="border-t border-indigo-500/10 px-6 md:px-10 lg:px-16 py-14"
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-indigo-400">
        Правовая информация
      </p>

      <h2
        id="legal-heading"
        className="mb-3 text-2xl md:text-3xl font-black leading-tight text-white"
      >
        {content.heading}
      </h2>

      <p className="mb-6 max-w-2xl text-sm text-neutral-500">{content.subheading}</p>

      <div className="mb-8 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-neutral-400">
        {content.preamble}
      </div>

      {/* Сам документ большой, поэтому разделы свёрнуты, но всегда доступны. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="legal-sections"
        className="mb-6 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-white/80 transition-colors hover:border-indigo-500/40 hover:text-indigo-300"
      >
        {expanded ? "Свернуть документ" : "Читать полный текст соглашения"}
      </button>

      {expanded && (
        <div id="legal-sections" className="max-w-3xl space-y-8">
          {content.sections.map((section, i) => (
            <article key={i}>
              <h3 className="mb-3 text-base font-bold text-white">{section.title}</h3>
              <div className="whitespace-pre-line text-sm leading-relaxed text-neutral-500">
                {section.content}
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Почты разных назначений: без подписей посетитель не понимал,
          куда писать по прессе, а куда — по персональным данным. */}
      <div
        id="legal-contacts"
        className="mt-10 border-t border-indigo-500/10 pt-6"
      >
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-indigo-400">
          Контакты администрации
        </p>

        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {content.contacts.map((contact) => (
            <div key={contact.key}>
              <dt className="text-sm font-semibold text-white">{contact.label}</dt>
              <dd className="mt-1">
                <a
                  href={`mailto:${contact.email}`}
                  className="text-sm text-indigo-400 transition-colors hover:text-indigo-300"
                >
                  {contact.email}
                </a>
                <span className="mt-1 block text-xs text-neutral-600">
                  {contact.hint}
                </span>
              </dd>
            </div>
          ))}
        </dl>

        <a
          href={content.contactUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-block text-sm text-indigo-400 transition-colors hover:text-indigo-300"
        >
          {content.contactUrl}
        </a>
      </div>
    </section>
  );
}

/**
 * Компактный список почт и адреса сайта для колонтитула /about.
 *
 * Раньше в колонтитуле были жёстко вбитые legal@trioz.ru и https://trioz.ru:
 * правка в админке их не меняла, а медийной почты не было вовсе.
 */
export function LegalContactLinks({
  overrides,
}: Pick<LegalFooterProps, "overrides"> = {}) {
  const content = useLegalContent(overrides);

  return (
    <>
      {content.contacts.map((contact) => (
        <a
          key={contact.key}
          href={`mailto:${contact.email}`}
          title={`${contact.label}: ${contact.hint}`}
          className="transition-colors hover:text-indigo-400"
        >
          {contact.label}: {contact.email}
        </a>
      ))}
      <a
        href={content.contactUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="transition-colors hover:text-indigo-400"
      >
        {content.contactUrl}
      </a>
    </>
  );
}
