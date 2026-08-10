"use client";

import { useTheme } from "@/components/Providers";

/**
 * Значок «TZ» — вход в окно Premium и VPN.
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
 */

interface PremiumMarkProps {
  isPremium: boolean;
  onClick?: () => void;
  /** Сторона квадрата в пикселях. В панели 44, в мобильной шапке чуть меньше. */
  size?: number;
}

export default function PremiumMark({ isPremium, onClick, size = 44 }: PremiumMarkProps) {
  const { theme } = useTheme();
  const isMono = theme === "mono";
  const isMonoLite = theme === "mono-lite";

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

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl flex items-center justify-center font-black text-base select-none transition-transform hover:scale-105 flex-shrink-0"
      style={{ width: size, height: size, ...style }}
      title="TZ.Connect Premium"
      aria-label="Открыть информацию о premium"
    >
      TZ
    </button>
  );
}
