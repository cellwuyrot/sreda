"use client";

import { useEffect, useState } from "react";
import { resolveLegalContent } from "@/lib/legal";

function useSiteLegalOverrides() {
  const [overrides, setOverrides] =
    useState<Record<string, string> | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/site-content", {
      cache: "no-store",
    })
      .then((response) => {
        if (!response.ok) {
          return null;
        }

        return response.json() as Promise<unknown>;
      })
      .then((data) => {
        if (cancelled) {
          return;
        }

        if (
          data &&
          typeof data === "object" &&
          !Array.isArray(data)
        ) {
          const values: Record<string, string> = {};

          for (const [key, value] of Object.entries(
            data as Record<string, unknown>,
          )) {
            if (typeof value === "string") {
              values[key] = value;
            }
          }

          setOverrides(values);
        }
      })
      .catch(() => {
        // Значения по умолчанию уже доступны.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return overrides;
}

export default function LegalFooter() {
  const overrides = useSiteLegalOverrides();
  const content = resolveLegalContent(overrides);

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
          <p className="whitespace-pre-line">
            {content.preamble}
          </p>
        </div>

        <div className="space-y-10">
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

        <div className="mt-12 grid gap-4 border-t border-indigo-500/10 pt-7 sm:grid-cols-2">
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

export function LegalContactLinks() {
  const overrides = useSiteLegalOverrides();
  const content = resolveLegalContent(overrides);

  return (
    <>
      <a
        href="#legal"
        className="transition-colors hover:text-indigo-400"
      >
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