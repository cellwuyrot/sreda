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
import { resolveLegalContent, type LegalContent } from "@/lib/legal";

/**
 * @param overrides готовые настройки siteConfig. Если переданы — запрос к API
 *   не выполняется (удобно для тестов и серверного рендера).
 */
export function useLegalContent(
  overrides?: Record<string, string> | null,
): LegalContent {
  const [content, setContent] = useState<LegalContent>(() =>
    resolveLegalContent(overrides ?? null),
  );

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

  return content;
}
