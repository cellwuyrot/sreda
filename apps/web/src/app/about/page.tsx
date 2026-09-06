/**
 * Страница /about — СЕРВЕРНЫЙ компонент.
 *
 * Главная причина того, что страница оставалась пустой на проде, была не в данных,
 * а в самой схеме рендера: весь текст появлялся только после клиентского
 * fetch("/api/about-blocks") в useEffect. В исходном HTML не было ни блоков, ни
 * правового подвала — только спиннер и фон. Любой сбой клиентского JS давал
 * ровно тот симптом, который наблюдался: страница открывается, скроллится, а текста нет.
 * Самый вероятный такой сбой здесь — CSP из src/middleware.ts: она выдаёт новый
 * одноразовый nonce на каждый ответ, и для заранее собранной (статической)
 * страницы nonce в HTML перестаёт совпадать с nonce в заголовке — браузер блокирует
 * все скрипты, и никакой useEffect никогда не выполнится. Пересборка от этого не лечит.
 *
 * Теперь данные берутся на сервере напрямую из базы, и весь текст — включая правовую
 * информацию в подвале — приезжает в исходном HTML. Страница читаема даже с
 * полностью отключённым JavaScript.
 */

import prisma from "@/lib/prisma";
import { buildAboutLayout, type AboutBlockRow } from "@/lib/aboutBlocks";
import { legalBlockOverrides } from "@/lib/legal";
import AboutPageClient from "@/components/about/AboutPageClient";

/* Содержимое меняется из админки, поэтому страница не кешируется: иначе
   правки появлялись бы только после пересборки проекта. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Блоки страницы. Ошибка базы не должна ронять страницу целиком. */
async function loadBlocks(): Promise<AboutBlockRow[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (prisma as any).aboutBlock as {
      findMany: (args: unknown) => Promise<AboutBlockRow[]>;
    };
    return await db.findMany({
      where: { visible: true },
      orderBy: { position: "asc" },
    });
  } catch (error) {
    // Видно в pm2 logs trioz — например, если не накатилась миграция.
    console.error("[about] не удалось загрузить блоки:", error);
    return [];
  }
}

/**
 * Правовые ключи из «Контент сайта \u2192 Правовая информация».
 *
 * При успешном чтении возвращает объект (даже пустой) — тогда клиенту не нужен
 * дополнительный запрос. При ошибке — null, и клиент догрузит текст сам.
 */
async function loadLegalSiteContent(): Promise<Record<string, string> | null> {
  try {
    const configs = await prisma.siteConfig.findMany({
      where: { key: { startsWith: "content:legal." } },
    });

    const result: Record<string, string> = {};
    for (const config of configs) {
      result[config.key.replace("content:", "")] = config.value;
    }
    return result;
  } catch (error) {
    console.error("[about] не удалось загрузить правовые тексты:", error);
    return null;
  }
}

export default async function AboutPage() {
  /* Два независимых чтения идут параллельно. */
  const [blocks, siteOverrides] = await Promise.all([
    loadBlocks(),
    loadLegalSiteContent(),
  ]);

  /* Единая раскладка: обычные блоки в тело, правовой — всегда в подвал,
     какова бы ни была его позиция и сколько бы их ни оказалось в базе. */
  const { bodyBlocks, legalBlock } = buildAboutLayout(blocks);

  /* Ключи блока дополняют текст из «Правовой информации» поле-за-поле:
     пустое поле блока ничего не стирает. */
  const legalOverrides = legalBlock
    ? legalBlockOverrides(legalBlock.data)
    : null;

  return (
    <AboutPageClient
      bodyBlocks={bodyBlocks}
      legalOverrides={legalOverrides}
      siteOverrides={siteOverrides}
    />
  );
}
