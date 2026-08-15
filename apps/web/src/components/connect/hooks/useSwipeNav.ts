"use client";

import { useCallback, useRef } from "react";

/* MOBILE-SWIPE: горизонтальные жесты мобильного клиента.

   Жест был ровно один и самый неудобный из возможных: тянуть вправо СТРОГО от
   левого края (первые 32 точки). На Android эта полоска занята системным жестом
   «назад», поэтому свайп панели практически не ловился: либо срабатывала
   система, либо не срабатывало ничего.

   Здесь жест считается с любого места экрана и отсеивается от чужих движений:

     • вертикальная составляющая больше половины горизонтальной — это прокрутка
       ленты, а не свайп;
     • два пальца — это масштабирование картинки;
     • жест, начатый внутри горизонтально прокручиваемого блока (блок кода,
       лента вложений, доска) или в помеченном data-swipe-ignore — чужой;
     • жест по полю ввода, видео и ползунку не перехватывается: там своё управление.

   Короткий быстрый смах засчитывается так же, как длинный медленный — иначе жест
   требует осознанного усилия и перестаёт быть интуитивным. */

const DISTANCE_PX = 64;
const QUICK_DISTANCE_PX = 28;
const QUICK_SPEED = 0.45; // точек в миллисекунду
const MAX_DURATION_MS = 800;
const VERTICAL_TOLERANCE = 0.6;

interface SwipeNavOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** Когда false, жесты не разбираются вовсе (например, на большом экране). */
  enabled?: boolean;
}

/** Жест начат внутри чужой горизонтальной прокрутки или своего управления? */
function startedOnOwnControl(target: EventTarget | null): boolean {
  let node: Element | null = target instanceof Element ? target : null;
  while (node && node !== document.body) {
    if (node.hasAttribute("data-swipe-ignore")) return true;
    const tag = node.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "VIDEO" || tag === "CANVAS") return true;
    if (node.getAttribute("role") === "slider") return true;
    if (node.scrollWidth - node.clientWidth > 8) {
      const overflowX = window.getComputedStyle(node).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
    node = node.parentElement;
  }
  return false;
}

export function useSwipeNav({ onSwipeLeft, onSwipeRight, enabled = true }: SwipeNavOptions) {
  const start = useRef<{ x: number; y: number; t: number; ok: boolean } | null>(null);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || e.touches.length !== 1) {
        start.current = null;
        return;
      }
      const t = e.touches[0];
      start.current = {
        x: t.clientX,
        y: t.clientY,
        t: Date.now(),
        ok: !startedOnOwnControl(e.target),
      };
    },
    [enabled],
  );

  /* Второй палец среди жеста — это уже масштабирование, жест отменяется. */
  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length > 1) start.current = null;
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const from = start.current;
      start.current = null;
      if (!enabled || !from || !from.ok) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - from.x;
      const dy = Math.abs(touch.clientY - from.y);
      const dt = Date.now() - from.t;
      if (dt > MAX_DURATION_MS) return;
      if (dy > Math.abs(dx) * VERTICAL_TOLERANCE) return;
      const speed = Math.abs(dx) / Math.max(dt, 1);
      const far = Math.abs(dx) >= DISTANCE_PX;
      const quick = Math.abs(dx) >= QUICK_DISTANCE_PX && speed >= QUICK_SPEED;
      if (!far && !quick) return;
      if (dx > 0) onSwipeRight?.();
      else onSwipeLeft?.();
    },
    [enabled, onSwipeLeft, onSwipeRight],
  );

  return { onTouchStart, onTouchMove, onTouchEnd };
}
