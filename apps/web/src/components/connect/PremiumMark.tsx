"use client";

import { useTheme } from "@/components/Providers";
import { useDesktopTunnel } from "@/lib/useDesktopTunnel";

/**
 * Значок «TZ» — выключатель защищённого соединения и вход в окно Premium.
 *
 * На большом экране он стоит первым в левой панели (NavRail) и служит входом в
 * единственное место, где выдаётся доступ к VPN. На телефоне левой панели нет —
 * она скрыта (`max-md:hidden`), — и вместе с ней пропадал вход: **в Android
 * VPN был недоступен не потому, что его не сделали, а потому что до него было
 * нечем дотянуться**.
 *
 * Отсюда и этот компонент: один значок, одна раскраска, два места. Скопировать
 * полсотни строк стилей во вторую шапку было бы проще, но тогда «золотой у
 * премиума» разъехался бы при первой же правке — и разъехался бы молча.
 *
 * Цвет — единственный признак, по которому видно, действует подписка или нет,
 * поэтому он и разный: золото в обычной теме, серебро в монохромной, строгий
 * чёрный в светлой монохромной.
 *
 * ── VPN-EMBEDDED ──
 * Теперь этот же значок и есть клиент: в приложении нажатие сразу включает или
 * выключает туннель встроенным клиентом — скачивать и устанавливать ничего не
 * надо. Состояние видно точкой в углу значка.
 *
 * Окно Premium при этом НЕ потерялось, и это принципиально: там тариф, остаток
 * трафика, выбор сервера и отзыв доступа. Оно открывается:
 *   • обычным нажатием — везде, где включать нечего (браузер, нет доступа);
 *   • правой кнопкой или с Shift/Alt — когда значок работает выключателем.
 */

interface PremiumMarkProps {
  isPremium: boolean;
  /** Открыть окно Premium/VPN. */
  onClick?: () => void;
  /** Сторона квадрата в пикселях. В панели 44, в мобильной шапке чуть меньше. */
  size?: number;
  /**
   * Отключить роль выключателя и всегда открывать окно.
   *
   * Нужно там, где значок уже служит другому действию — например, раскрывает
   * меню соединения: там второе значение у одного нажатия только запутало бы.
   */
  asToggle?: boolean;
}

export default function PremiumMark({ isPremium, onClick, size = 44, asToggle = true }: PremiumMarkProps) {
  const { theme } = useTheme();
  const isMono = theme === "mono";
  const isMonoLite = theme === "mono-lite";
  const tunnel = useDesktopTunnel();

  /* Значок работает выключателем только там, где выключать есть что. В браузере
     и без доступа он остаётся тем, чем был — входом в окно. */
  const switchMode = asToggle && tunnel.canToggle;

  const style: React.CSSProperties = isPremium
    ? isMono
      ? {
          // Монохром: серебряный монолит, без цветного свечения.
          background: "linear-gradient(135deg, #ececee 0%, #b8b8be 55%, #8a8a90 100%)",
          color: "#141416",
          border: "1px solid rgba(255, 255, 255, 0.55)",
          letterSpacing: "-0.5px",
        }
      : isMonoLite
        ? {
            // Монохром светлый: строгий чёрный на белом, без золота и свечения.
            background: "#f2f2f2",
            color: "#000000",
            border: "1px solid rgba(0,0,0,0.20)",
            letterSpacing: "-0.5px",
          }
        : {
            background: "linear-gradient(135deg, #ffe08a 0%, #f5c542 45%, #d4a017 100%)",
            color: "#4a3200",
            border: "1px solid rgba(255, 214, 110, 0.85)",
            letterSpacing: "-0.5px",
            boxShadow: "0 0 18px rgba(240, 190, 60, 0.55)",
          }
    : {
        background: "var(--cn-accent-dim)",
        color: "var(--cn-accent-text)",
        border: "1px solid color-mix(in srgb, var(--cn-accent) 20%, transparent)",
        letterSpacing: "-0.5px",
      };

  /* Включённый туннель подсвечиваем кольцом, а не подменой фона: фон занят тарифом,
     и два смысла в одном цвете стали бы нечитаемы. */
  const ringStyle: React.CSSProperties = tunnel.on
    ? { boxShadow: `${style.boxShadow ? `${style.boxShadow}, ` : ""}0 0 0 2px rgba(34,197,94,0.85)` }
    : tunnel.pending
      ? { boxShadow: `${style.boxShadow ? `${style.boxShadow}, ` : ""}0 0 0 2px rgba(34,211,238,0.75)` }
      : {};

  const label = switchMode
    ? tunnel.on
      ? "Выключить защищённое соединение (Premium)"
      : "Включить защищённое соединение (Premium)"
    : "Открыть информацию о premium";

  const title = switchMode
    ? `${tunnel.on ? "Соединение включено" : tunnel.pending ? "Переключаем…" : "Соединение выключено"} · нажмите, чтобы ${tunnel.on ? "выключить" : "включить"} · правая кнопка — подробности`
    : "TZ.Connect Premium";

  return (
    <button
      type="button"
      onClick={(e) => {
        /* Shift/Alt и правая кнопка — прямой путь к окну, когда значок включает VPN. */
        if (switchMode && !e.shiftKey && !e.altKey) {
          void tunnel.toggle();
          return;
        }
        onClick?.();
      }}
      onContextMenu={(e) => {
        if (!switchMode) return;
        e.preventDefault();
        onClick?.();
      }}
      className="relative rounded-xl flex items-center justify-center font-black text-base select-none transition-transform hover:scale-105 flex-shrink-0"
      style={{ width: size, height: size, ...style, ...ringStyle }}
      title={title}
      aria-label={label}
      aria-pressed={switchMode ? tunnel.on : undefined}
    >
      TZ
      {/* Точка состояния: без неё включённый и выключенный VPN выглядят одинаково. */}
      {tunnel.available && (tunnel.on || tunnel.pending) && (
        <span
          aria-hidden
          className="absolute rounded-full"
          style={{
            right: -1,
            bottom: -1,
            width: 10,
            height: 10,
            background: tunnel.on ? "#22c55e" : "#22d3ee",
            border: "2px solid var(--cn-bg, #0b0b0f)",
          }}
        />
      )}
    </button>
  );
}
