"use client";

/**
 * PERF-GPU: гасит непрерывную работу графического ускорителя, когда окно
 * приложения не видно человеку.
 *
 * Почему это нужно именно в оболочке: в `mainWindow.ts` намеренно выключено
 * `backgroundThrottling` (FIX-OVL-THROTTLE) — иначе накладка звонка замирает,
 * пока пользователь работает в другом окне. Побочный итог: Chromium продолжает
 * СОСТАВЛЯТЬ КАДРЫ для свёрнутого окна, а составление кадра — это работа
 * видеокарты. Все бесконечные CSS-анимации (мерцание звёзд, вращение орбит,
 * пульсация индикаторов) и слои с размытием при этом перерисовываются 60 раз в
 * секунду в никуда. Отсюда и постоянная загрузка GPU без всякой пользы.
 *
 * Решение не отключает ускорение целиком (без него пострадали бы видео и
 * демонстрация экрана) и не трогает верстку: мы лишь ставим на паузу анимации и
 * снимаем размытие, пока окно скрыто. Возврат фокуса восстанавливает всё
 * мгновенно, потому что состояние живёт в CSS, а не в JS.
 *
 * Отдельно уважаем системную настройку «уменьшить движение»: если человек её
 * включил, анимации не запускаются вообще — это заодно снимает нагрузку
 * навсегда на слабых машинах.
 */

import { useEffect } from "react";

export function IdleAnimationGuard() {
  useEffect(() => {
    const root = document.documentElement;

    /* «Простой» — это скрытое окно. Потеря фокуса сама по себе простоем не
       считается: окно рядом с другим окном человек видит, и застывшая
       картинка выглядела бы поломкой. */
    const apply = () => {
      if (document.hidden) root.setAttribute("data-tz-idle", "1");
      else root.removeAttribute("data-tz-idle");
    };

    apply();
    document.addEventListener("visibilitychange", apply);

    /* Системная настройка может измениться на ходу (например, из режима
       экономии батареи), поэтому слушаем её, а не читаем один раз. */
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const applyMotion = () => {
      if (motion?.matches) root.setAttribute("data-tz-still", "1");
      else root.removeAttribute("data-tz-still");
    };
    applyMotion();
    motion?.addEventListener?.("change", applyMotion);

    return () => {
      document.removeEventListener("visibilitychange", apply);
      motion?.removeEventListener?.("change", applyMotion);
      root.removeAttribute("data-tz-idle");
      root.removeAttribute("data-tz-still");
    };
  }, []);

  return null;
}

export default IdleAnimationGuard;
