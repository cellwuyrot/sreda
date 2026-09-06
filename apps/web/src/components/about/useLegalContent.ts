"use client";

/**
 * Единственный источник правового текста для всей страницы /about.
 *
 * Приоритет (каждый следующий уровень дополняет предыдущий поле-за-поле):
 *   1. редакция по умолчанию из LEGAL_DEFAULTS / LEGAL_SECTIONS;
 *   2. Админ-панель → Контент сайта → Правовая информация (/api/site-content);
 *   3. данные блока «Правовая информация» из Контент сайта → О проекте.
 *
 * Пустые значения никогда не затирают заполненные — разделы дополняют друг
 * друга, поэтому конфликт двух редакторов невозможен по построению.
 *
 * Важно про зависимости: в useEffect попадает только пустой массив, потому что
 * объекты-пропсы пересоздаются на каждый рендер и раньше вызывали
 * бесконечный цикл «запрос → рендер → запрос», из-за которого раздел не
 * успевал отрисоваться. Запрос сайт-контента выполняется ровно один раз.
 */

import { useEffect, useState } from "react";
import {
  mergeLegalOverrides,
  resolveLegalContent,
  type LegalContent,
} from "@/lib/legal";

type Overrides = Record<string, string> | null | undefined;

export function useLegalContent(
  blockOverrides?: Overrides,
  initialSiteContent?: Overrides,
): LegalContent {
  const [siteContent, setSiteContent] = useState<Record<
    string,
    string
  > | null>(initialSiteContent ?? null);

  useEffect(() => {
    // Если текст уже передан снаружи (серверный рендер, тесты) — не запрашиваем.
    if (initialSiteContent) {
      return;
    }

    let cancelled = false;

    fetch("/api/site-content", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: unknown) => {
        if (cancelled) return;
        if (!data || typeof data !== "object" || Array.isArray(data)) return;

        const values: Record<string, string> = {};

        for (const [key, value] of Object.entries(
          data as Record<string, unknown>,
        )) {
          if (typeof value === "string") {
            values[key] = value;
          }
        }

        setSiteContent(values);
      })
      .catch(() => {
        // Остаётся редакция по умолчанию — подвал никогда не остаётся пустым.
      });

    return () => {
      cancelled = true;
    };
    // Зависимостей нет вовсе: запрос выполняется ровно один раз за жизнь компонента.
    // Объекты-пропсы сюда попасть не могут, а значит бесконечный цикл невозможен.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return resolveLegalContent(
    mergeLegalOverrides(siteContent, null, blockOverrides),
  );
}
