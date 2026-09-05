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
import { resolveLegalContent, type LegalContent } from "@/lib/legal";

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
  // Стартуем сразу с редакции по умолчанию — текст есть до любых запросов.
  const [content, setContent] = useState<LegalContent>(() =>
    resolveLegalContent(overrides ?? null),
  );
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    if (overrides) return;

    let cancelled = false;

    // no-store: правки из админки должны появляться на /about сразу, без
    // ожидания истечения браузерного кеша GET-запроса.
    fetch("/api/site-content", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Record<string, string> | null) => {
        if (cancelled) return;
        setContent(resolveLegalContent(data));
      })
      .catch(() => {
        /* остаётся редакция по умолчанию */
      });

    return () => {
      cancelled = true;
    };
  }, [overrides]);

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

      <div className="mt-10 flex flex-wrap gap-5 border-t border-indigo-500/10 pt-6">
        <a
          href={`mailto:${content.contactEmail}`}
          className="text-sm text-indigo-400 transition-colors hover:text-indigo-300"
        >
          {content.contactEmail}
        </a>
        <a
          href={content.contactUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-indigo-400 transition-colors hover:text-indigo-300"
        >
          {content.contactUrl}
        </a>
      </div>
    </section>
  );
}
