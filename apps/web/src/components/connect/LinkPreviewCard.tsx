"use client";

/**
 * Карточка ссылки под сообщением: заголовок, описание, картинка.
 *
 * Метаданные приносит серверный маршрут `/api/link-preview` — из браузера
 * чужой домен закрыт CORS, а прямой запрос из вкладки ещё и раскрыл бы IP
 * читателя владельцу ссылки.
 *
 * Карточка ничего не показывает, пока данные не пришли: пустая рамка-заглушка
 * дёргала бы ленту при каждой загрузке. Не получилось — просто не появляется,
 * сама ссылка в тексте остаётся кликабельной.
 */

import { useEffect, useState } from "react";

interface Preview {
  url: string;
  title: string;
  description: string;
  image: string | null;
  siteName: string;
}

/** Кэш на вкладку: одна ссылка встречается в ленте не раз. */
const memo = new Map<string, Preview | null>();

export default function LinkPreviewCard({ url }: { url: string }) {
  const [data, setData] = useState<Preview | null>(() => memo.get(url) ?? null);

  useEffect(() => {
    if (memo.has(url)) {
      setData(memo.get(url) ?? null);
      return;
    }
    let alive = true;
    fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Preview | null) => {
        const value = d && (d.title || d.description || d.image) ? d : null;
        memo.set(url, value);
        if (alive) setData(value);
      })
      .catch(() => {
        memo.set(url, null);
      });
    return () => { alive = false; };
  }, [url]);

  if (!data) return null;

  return (
    <a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1.5 flex gap-3 max-w-[440px] rounded-xl border border-[var(--cn-border)] bg-[var(--cn-card)] p-2.5 hover:border-violet-400 dark:hover:border-cyan-400/60 transition-colors"
    >
      {data.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.image}
          alt=""
          loading="lazy"
          className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
        />
      )}
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-neutral-400 truncate">{data.siteName}</p>
        {data.title && (
          <p className="text-xs font-semibold text-neutral-900 dark:text-white line-clamp-2">{data.title}</p>
        )}
        {data.description && (
          <p className="text-[11px] text-neutral-500 dark:text-gray-400 line-clamp-2 mt-0.5">{data.description}</p>
        )}
      </div>
    </a>
  );
}

/** Первая ссылка в тексте — разворачиваем только её, чтобы не завалить ленту. */
export function firstLink(text: string): string | null {
  const match = /https?:\/\/[^\s<>"']+/i.exec(text);
  if (!match) return null;
  // Хвостовая пунктуация в конце предложения не часть адреса.
  return match[0].replace(/[.,;:!?)\]]+$/, "");
}
