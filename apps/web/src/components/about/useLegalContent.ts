"use client";

/**
 * Действующая редакция правовой информации для клиентских компонентов.
 *
 * Подвал /about показывает одни и те же данные в двух местах: большой блок
 * с соглашением и короткая строка ссылок в самом низу страницы. Чтобы почты
 * и адрес сайта не расходились (раньше в колонтитуле был жёстко вбитый
 * legal@trioz.ru), оба места берут данные из этого хука.
 *
 * Свойство, которое важно сохранить: текст есть всегда. Первый рендер идёт
 * с редакцией из кода, а отказ сети, 403 или битый JSON её не стирают.
 */

import { useEffect, useState } from "react";
import {
  legacyLegalOverrides,
  mergeLegalOverrides,
  resolveLegalContent,
  type LegalContent,
} from "@/lib/legal";

/** Находит унаследованный блок соглашения среди блоков «О проекте». */
function legalBlockOverrides(blocks: unknown): Record<string, string> {
  if (!Array.isArray(blocks)) return {};

  const row = blocks.find(
    (b) => b && typeof b === "object" && (b as { type?: unknown }).type === "legal",
  ) as { data?: unknown } | undefined;

  return legacyLegalOverrides(row?.data);
}

/**
 * @param overrides готовые настройки siteConfig. Если переданы — запрос к API
 *   не выполняется (удобно для тестов и серверного рендера).
 */
export function useLegalContent(
  overrides?: Record<string, string> | null,
  /**
   * Данные блока «Правовая информация» со страницы. Единый редактор
   * важнее старых ключей siteConfig — именно из-за обратного приоритета
   * правки в блоке раньше не доезжали до страницы.
   */
  blockOverrides?: Record<string, string> | null,
): LegalContent {
  const [content, setContent] = useState<LegalContent>(() =>
    resolveLegalContent(mergeLegalOverrides(overrides, blockOverrides)),
  );

  useEffect(() => {
    if (overrides) return;

    let cancelled = false;

    // Два источника сразу:
    //   • /api/site-content — раздел «Контент сайта → Правовая информация»;
    //   • /api/about-blocks — унаследованный блок 'legal', в котором текст
    //     редактировался раньше.
    // Именно из-за чтения только одного из них ранее и пропадал
    // большой текст соглашения на /about.
    const json = (url: string) =>
      fetch(url, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

    Promise.all([json("/api/site-content"), json("/api/about-blocks")]).then(
      ([siteContent, blocks]) => {
        if (cancelled) return;

        // Приоритет снизу вверх: редакция из кода → старые ключи
        // siteConfig → блок единого редактора «О проекте».
        setContent(
          resolveLegalContent(
            mergeLegalOverrides(
              siteContent as Record<string, string> | null,
              legalBlockOverrides(blocks),
              blockOverrides,
            ),
          ),
        );
      },
    );

    return () => {
      cancelled = true;
    };
  }, [overrides, blockOverrides]);

  return content;
}
