"use client";

/**
 * FIX-IMGMENU: меню по правому клику на картинке.
 *
 * Зачем своё меню, если у браузера есть своё. Потому что штатное «Сохранить
 * картинку как…» сохраняет файл под именем с диска, а на диске у нас uuid вроде
 * `8f3c….webp` — пользователь получает горсть неопознаваемых файлов. Кроме того:
 *
 *   • в Electron своего context-menu нет вовсе — правый клик там не делает ничего;
 *   • в Android WebView его тоже нет, а долгое нажатие выделяет текст.
 *
 * За образец взят UserContextMenu: портал на body, клампинг во вьюпорт, закрытие
 * по Esc и клику вне, те же классы пунктов. Портал здесь не украшение: строка
 * сообщения использует `content-visibility` (paint containment), и меню, отрисованное
 * внутри неё, обрезалось бы по краю строки — та же причина, что и у эмодзи.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { startFileDownload } from "@/lib/downloadFile";

const ITEM =
  "w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-left transition-colors text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.07] disabled:opacity-50 disabled:cursor-default";

export interface ImageContextMenuProps {
  /** Адрес картинки — именно сетевой, не blob и не data. */
  src: string;
  /** Имя для сохранения. Если его нет, берётся хвост адреса. */
  name?: string;
  x: number;
  y: number;
  onClose: () => void;
  /** Пункт «Открыть» нужен не везде: из самого лайтбокса он лишний. */
  onOpen?: () => void;
}

/**
 * Имя файла из адреса — запасной вариант, когда отправитель его не передал.
 * Получится uuid, и это всё равно лучше пустого имени: часть браузеров сохраняет
 * безымянный файл как `download` вообще без расширения.
 */
function nameFromUrl(src: string): string {
  const clean = src.split("?")[0] ?? "";
  const last = clean.split("/").pop() ?? "";
  return last || "image";
}

export default function ImageContextMenu({ src, name, x, y, onClose, onOpen }: ImageContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => setMounted(true), []);

  /* Клампинг во вьюпорт. Если снизу от точки клика меню не помещается — раскрываем
     вверх, а не прижимаем к кромке. Случай частый: свежие картинки в чате всегда
     внизу экрана. Второй проход в requestAnimationFrame нужен потому, что до первого
     кадра размеры меню ещё не окончательны. */
  useLayoutEffect(() => {
    const place = () => {
      const el = menuRef.current;
      if (!el) return;
      const margin = 10;
      const height = el.offsetHeight;
      let top = y;
      if (y + height > window.innerHeight - margin) top = y - height;
      top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
      setPos({
        left: Math.max(margin, Math.min(x, window.innerWidth - el.offsetWidth - margin)),
        top,
      });
    };
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
    };
  }, [x, y, mounted, copied]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    /* Прокрутка тоже закрывает меню: оно привязано к точке экрана, а не к картинке,
       и после прокрутки указывало бы уже на чужое сообщение. */
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  if (!mounted) return null;

  const fileName = name || nameFromUrl(src);

  const absolute = () => {
    if (typeof window === "undefined") return src;
    try {
      return new URL(src, window.location.origin).href;
    } catch {
      return src;
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(absolute());
      setCopied(true);
      /* Меню не закрываем сразу: без подтверждения непонятно, сработало ли. */
      setTimeout(onClose, 700);
    } catch {
      /* clipboard требует защищённого контекста; если не вышло — просто закрываем. */
      onClose();
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-[95] min-w-[190px] p-1 rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-xl"
      onContextMenu={(e) => e.preventDefault()}
      role="menu"
    >
      {onOpen && (
        <button
          type="button"
          className={ITEM}
          role="menuitem"
          onClick={() => {
            onOpen();
            onClose();
          }}
        >
          Открыть
        </button>
      )}
      <button
        type="button"
        className={ITEM}
        role="menuitem"
        onClick={() => {
          /* Тот же путь, что у документов: `?dl=1&name=` и ветки по оболочке.
             Именно он даёт человеческое имя файла вместо uuid с диска. */
          startFileDownload(src, fileName);
          onClose();
        }}
      >
        Скачать картинку
      </button>
      <button type="button" className={ITEM} role="menuitem" onClick={copyLink}>
        {copied ? "Ссылка скопирована" : "Копировать ссылку"}
      </button>
      <button
        type="button"
        className={ITEM}
        role="menuitem"
        onClick={() => {
          window.open(absolute(), "_blank", "noopener,noreferrer");
          onClose();
        }}
      >
        Открыть в новой вкладке
      </button>
    </div>,
    document.body,
  );
}

/**
 * Хук для картинки: правый клик ПЛЮС долгое нажатие.
 *
 * Долгое нажатие приходится делать вручную: на телефоне правого клика нет, а
 * событие `contextmenu` в Android WebView по долгому нажатию не приходит.
 *
 * Порог 500 мс и допуск 10 px на сдвиг — чтобы меню не выскакивало при прокрутке
 * ленты пальцем по картинке: прокрутка всегда начинается со сдвига.
 */
export function useImageContextMenu() {
  const [menu, setMenu] = useState<{ src: string; name?: string; x: number; y: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => clearTimer, []);

  const bind = (src: string, name?: string) => ({
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      setMenu({ src, name, x: e.clientX, y: e.clientY });
    },
    onTouchStart: (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      const point = { x: touch.clientX, y: touch.clientY };
      startRef.current = point;
      clearTimer();
      timerRef.current = setTimeout(() => setMenu({ src, name, x: point.x, y: point.y }), 500);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const touch = e.touches[0];
      const start = startRef.current;
      if (!touch || !start) return;
      if (Math.abs(touch.clientX - start.x) > 10 || Math.abs(touch.clientY - start.y) > 10) clearTimer();
    },
    onTouchEnd: clearTimer,
    onTouchCancel: clearTimer,
  });

  return { menu, bind, close: () => setMenu(null) };
}
