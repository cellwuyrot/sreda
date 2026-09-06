"use client";

/**
 * Действующая редакция правовой информации для клиентских компонентов.
 *
 * ПОЧЕМУ ПЕРЕПИСАНО.
 * Прошлая версия принимала объекты (`overrides`, `blockOverrides`) прямо в
 * зависимости useEffect. Страница /about создавала такой объект заново на
 * каждый рендер, поэтому эффект считал зависимости изменившимися, снова делал
 * запрос, снова вызывал setState — и получался бесконечный цикл
 * «запрос → рендер → запрос». Из-за него раздел не успевал отрисоваться:
 * блок был включён, текст в админке был, а на странице не появлялось ничего.
 *
 * Теперь:
 *   • зависимости эффекта — строки (стабильные при равных данных), поэтому
 *     запрос выполняется один раз;
 *   • источник один — «Контент сайта → Правовая информация» (siteConfig).
 *     Блоков страница больше не догружает: данные блока приходят пропсом.
 *     Именно двойное чтение и давало «пересечение информации»;
 *   • приоритет: редакция из кода → siteConfig → данные блока;
 *   • текст есть всегда: отказ сети, 403 или битый JSON не стирают его.
 */

import { useEffect, useState } from "react";
import {
  mergeLegalOverrides,
  resolveLegalContent,
  type LegalContent,
} from "@/lib/legal";

type Overrides = Record<string, string> | null | undefined;

/** Стабильный ключ: одинаковые данные — одинаковая строка. */
function keyOf(overrides: Overrides): string {
  if (!overrides) return "";
  return JSON.stringify(
    Object.keys(overrides)
      .sort()
      .map((k) => [k, overrides[k]]),
  );
}

export function useLegalContent(
  /** Готовые ключи siteConfig. Если переданы — запрос не выполняется. */
  overrides?: Overrides,
  /** Данные блока «Правовая информация» страницы — высший приоритет. */
  blockOverrides?: Overrides,
): LegalContent {
  const overridesKey = keyOf(overrides);

  // Ответ API храним отдельно от пропсов, чтобы слияние оставалось чистым.
  const [siteContent, setSiteContent] = useState<Record<string, string> | null>(
    null,
  );

  useEffect(() => {
    // Данные переданы явно (тесты, серверный рендер) — сеть не нужна.
    if (overridesKey) return;

    let cancelled = false;

    fetch("/api/site-content", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((data) => {
        if (cancelled) return;
        if (data && typeof data === "object" && !Array.isArray(data)) {
          setSiteContent(data as Record<string, string>);
        }
      });

    return () => {
      cancelled = true;
    };
    // Только строки: объекты в зависимостях и вызывали бесконечный цикл.
  }, [overridesKey]);

  // Слияние считается на рендер. Запоминание здесь не нужно и даже вредно:
  // результат нигде не попадает в зависимости других хуков, а объём данных —
  // несколько десятков строк. Зато нет ни списков зависимостей со сложными
  // выражениями, ни подавленных правил eslint.
  return resolveLegalContent(
    mergeLegalOverrides(siteContent, overrides, blockOverrides),
  );
}
