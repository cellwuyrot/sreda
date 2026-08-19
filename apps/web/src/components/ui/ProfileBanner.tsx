"use client";

import { useEffect, useState } from "react";
import { bannerImgStyle } from "@/lib/bannerFraming";

/**
 * FIX-BANNERONE: фон профиля рисуется здесь и только здесь.
 *
 * Раньше мест было три, и они расходились:
 *
 *  • страница профиля показывала фон свойством background-image блока, а
 *    мини-профиль — тегом <img>. Одна и та же картинка при этом кадрировалась
 *    по-разному (масштаб фоном считается от ширины блока, у <img> — от самой
 *    картинки), и рамка, выставленная в настройках, совпадала только случайно;
 *  • у фона-свойства нет события ошибки: если файла нет, блок просто оставался
 *    пустым, и со стороны это выглядело как «в вебе фона профиля нет», хотя в
 *    десктопе он показывался из локального кеша картинок
 *    (apps/desktop/src/main/mediaCache.ts);
 *  • компонент MiniProfile содержал третью копию той же разметки.
 *
 * Теперь и мини-профиль, и страница пользователя показывают одну картинку
 * одним кодом: <img> с рамкой из адреса и подложкой-градиентом под ним.
 */
export default function ProfileBanner({
  src,
  className = "",
  overlay = true,
}: {
  src?: string | null;
  /** Высота и скругления задаются вызывающим: шапка и карточка разной формы. */
  className?: string;
  /** Затемнение снизу вверх — под аватар и имя. */
  overlay?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <div
      className={`relative overflow-hidden bg-gradient-to-br from-violet-500/30 to-indigo-600/20 dark:from-cyan-500/20 dark:to-violet-600/20 ${className}`}
    >
      {src && !failed && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={bannerImgStyle(src)}
          onError={() => setFailed(true)}
        />
      )}
      {overlay && <div className="absolute inset-0 bg-gradient-to-t from-black/25 to-transparent" />}
    </div>
  );
}
