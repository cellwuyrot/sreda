"use client";

/**
 * HOVER-GRACE: общее состояние «у какого сообщения показан бар действий».
 *
 * Зачем это вообще нужно, если есть CSS `:hover`. Бар висит НАД пузырём
 * сообщения, то есть за границей строки, и между текстом и баром есть зазор.
 * Пока курсор пересекает эти несколько пикселей, он не над строкой и не над
 * баром — чистый `:hover` в этот момент гаснет, и кнопки просто невозможно
 * поймать. Отсюда три правила:
 *
 * 1. При уводе мыши бар гаснет НЕ сразу, а через паузу (`graceMs`).
 * 2. Наведение на сам бар сбрасывает таймер — пока курсор на кнопках,
 *    бар не исчезнет никогда.
 * 3. Активное сообщение всегда ровно одно: перешёл на соседнее — предыдущий
 *    бар гаснет мгновенно, без паузы. Именно поэтому здесь один id на список,
 *    а не флаг в каждой строке: два бара одновременно становятся невозможны
 *    по устройству, а не по аккуратности обработчиков.
 *
 * Состояние даёт только класс `tz-msg-hot` на строке — раскладка не меняется
 * (см. FIX-HOVER-JUMP в globals.css: любое изменение высоты по наведению заставляло
 * ленту подпрыгивать).
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Запас времени на перевод мыши с текста на кнопки. */
export const HOVER_TOOLBAR_GRACE_MS = 900;

export interface HoverToolbarState {
  /** id сообщения, у которого сейчас показан бар. */
  activeId: string | null;
  /** Показать бар и заморозить таймер скрытия. */
  hold: (id: string) => void;
  /** Запустить отложенное скрытие именно этого бара. */
  release: (id: string) => void;
  /** Скрыть немедленно (например, перед открытием модалки). */
  hide: () => void;
}

export function useHoverToolbar(graceMs: number = HOVER_TOOLBAR_GRACE_MS): HoverToolbarState {
  const [activeId, setActiveId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hold = useCallback(
    (id: string) => {
      stopTimer();
      /* Переход на другое сообщение — без паузы: старый бар гаснет тем, что
         активный id стал другим. */
      setActiveId((current) => (current === id ? current : id));
    },
    [stopTimer],
  );

  const release = useCallback(
    (id: string) => {
      stopTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        /* Гасим только то, что сами показали: если за время паузы курсор ушёл
           на соседнее сообщение, его бар останется на месте. */
        setActiveId((current) => (current === id ? null : current));
      }, graceMs);
    },
    [graceMs, stopTimer],
  );

  const hide = useCallback(() => {
    stopTimer();
    setActiveId(null);
  }, [stopTimer]);

  useEffect(() => stopTimer, [stopTimer]);

  return { activeId, hold, release, hide };
}
