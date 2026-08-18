import type { SVGProps } from "react";

type IconTone = "active" | "inactive" | "muted" | "danger";

// FIX-ICONS: PNG-канон («вариант A», /public/icons + cn-icon) упразднён.
// Все иконки набора теперь рисуются единым фирменным стилем IconBase:
// контурный SVG 24×24, stroke 1.9, currentColor — как voiceIcons,
// ConnectIconsExtra и SVG-эмодзи-пак TrioZ. Это даёт точную перекраску в
// светлой/тёмной/mono темах без CSS-фильтров и один визуальный язык везде.

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
  tone?: IconTone;
  crossed?: boolean;
  /** Add a cyan glow (box-shadow) — used for active/important icons like the bell. */
  glow?: boolean;
}

function toneClass(tone: IconTone = "inactive") {
  switch (tone) {
    case "active":
      return "text-cyan-400";
    case "muted":
      return "text-gray-400";
    case "danger":
      return "text-red-400";
    default:
      return "text-neutral-400";
  }
}

function IconBase({ size = 20, tone = "inactive", crossed = false, glow = false, className = "", children, ...props }: IconProps) {
  const glowStyle = glow && tone === "active"
    ? { boxShadow: "0 0 12px rgba(0,240,255,0.45)", borderRadius: 6, padding: 2 }
    : undefined;
  return (
    <span className={`relative inline-flex items-center justify-center ${toneClass(tone)} ${className}`} style={glowStyle}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        {children}
      </svg>
      {crossed && (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="absolute inset-0 pointer-events-none">
          <path d="M5 19L19 5" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 18a2 2 0 004 0" />
    </IconBase>
  );
}

/* FIX-POLLBLOCK: было четыре штриха — столбчатая диаграмма общего вида, такой же
   значок берёт любая статистика. Опрос — это варианты с отметкой выбора:
   карточка, строки-варианты, выбранный отмечен галкой. */
export function PollIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="4" width="18" height="16" rx="3.5" />
      <path d="M6.2 9.1l1.1 1.2 2.1-2.4" />
      <path d="M12.4 9h5" />
      <circle cx="7.4" cy="15" r="1.3" />
      <path d="M12.4 15h3.2" />
    </IconBase>
  );
}

export function TaskIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 10l2 2 5-5" />
    </IconBase>
  );
}

export function CommunitiesIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="4" y="10" width="4" height="9" rx="1" />
      <rect x="10" y="6" width="4" height="13" rx="1" />
      <rect x="16" y="10" width="4" height="9" rx="1" />
      <path d="M4 10l2-3 2 3" />
      <path d="M10 6l2-3 2 3" />
      <path d="M16 10l2-3 2 3" />
    </IconBase>
  );
}

export function FriendsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="9" cy="8" r="2.5" />
      <circle cx="16" cy="9" r="2" />
      <path d="M4.5 18a4.5 4.5 0 019 0" />
      <path d="M13.5 18a3.5 3.5 0 017 0" />
    </IconBase>
  );
}

export function MessagesIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H9l-4 3v-3H5a2 2 0 01-2-2V8a2 2 0 012-2z" />
    </IconBase>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 5h14a2 2 0 012 2v8a2 2 0 01-2 2H9l-4 3v-3H5a2 2 0 01-2-2V7a2 2 0 012-2z" />
      <path d="M8 10h8" />
      <path d="M8 13h5" />
    </IconBase>
  );
}

export function NewsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 8h6" />
      <path d="M8 12h8" />
      <path d="M8 16h8" />
    </IconBase>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0012 0" />
      <path d="M12 17v3" />
      <path d="M8 20h8" />
    </IconBase>
  );
}

// FIX-ICON-GEAR: раньше здесь был круг с восемью лучами — дубликат солнца
// (ThemeSunIcon), из-за чего кнопка «Настройки профиля» читалась как «фонарик».
// Теперь — классическая шестерёнка: контур зубцов + втулка, в том же стиле
// IconBase (stroke, currentColor).
export function GearIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33h.01a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51h.01a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.01a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </IconBase>
  );
}

export function ThemeMoonIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M20 14.5A7.5 7.5 0 119.5 4 6 6 0 0020 14.5z" />
    </IconBase>
  );
}

export function ThemeSunIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="M4.9 4.9l1.4 1.4" />
      <path d="M17.7 17.7l1.4 1.4" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="M4.9 19.1l1.4-1.4" />
      <path d="M17.7 6.3l1.4-1.4" />
    </IconBase>
  );
}

export function ReplyIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h9a7 7 0 017 7v4" />
    </IconBase>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 16v6" />
      <path d="M9 4h6v5l2.5 3.5a1 1 0 01-.8 1.5H7.3a1 1 0 01-.8-1.5L9 9V4z" />
      <path d="M8 4h8" />
    </IconBase>
  );
}

export function ThreadIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M7 8h10" />
      <path d="M7 12h7" />
      <path d="M7 16h5" />
      <path d="M17 12l4 4-4 4" />
    </IconBase>
  );
}

export function ForwardIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9h-9a7 7 0 00-7 7v4" />
    </IconBase>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path d="M14 3v5h5" />
    </IconBase>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 118 0v3" />
    </IconBase>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function CompletedTaskIcon(props: IconProps) {
  return <TaskIcon {...props} tone="muted" crossed />;
}

export function CancelledTaskIcon(props: IconProps) {
  return <BellIcon {...props} tone="muted" crossed />;
}

/* ── Additional flat icons (replacing remaining emojis) ── */

export function CrownIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 8l4 4 4-7 4 7 4-4-2 10H6L4 8z" />
      <path d="M6 20h12" />
    </IconBase>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z" />
      <path d="M9 12l2 2 4-4" />
    </IconBase>
  );
}

export function SparklesIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 4l1.5 4.5L18 10l-4.5 1.5L12 16l-1.5-4.5L6 10l4.5-1.5L12 4z" />
      <path d="M18 15l.7 2L21 18l-2.3.9L18 21l-.7-2.1L15 18l2.3-1L18 15z" />
    </IconBase>
  );
}

export function FilmIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16" />
      <path d="M17 4v16" />
      <path d="M3 9h4" />
      <path d="M3 15h4" />
      <path d="M17 9h4" />
      <path d="M17 15h4" />
    </IconBase>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M20 14.5A7.5 7.5 0 119.5 4 6 6 0 0020 14.5z" />
      <path d="M16 11h.01" />
    </IconBase>
  );
}

export function KeyIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="8" cy="8" r="4" />
      <path d="M11 11l8 8" />
      <path d="M16 16l2-2" />
      <path d="M19 19l2-2" />
    </IconBase>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M5 16v2a2 2 0 002 2h10a2 2 0 002-2v-2" />
    </IconBase>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 4v12" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 20h14" />
    </IconBase>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </IconBase>
  );
}

export function QuestionIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 3.5" />
      <path d="M12 17h.01" />
    </IconBase>
  );
}

export function CastleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 21h18" />
      <path d="M4 21V10l2 1V7l2 1V4l2 1V3h4v2l2-1v3l2-1v4l2-1v11" />
      <path d="M10 21v-4a2 2 0 014 0v4" />
    </IconBase>
  );
}

export function VoiceChannelIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0012 0" />
      <path d="M12 17v3" />
      <path d="M8 20h8" />
    </IconBase>
  );
}

/* ── FIX-ICONS: иконки, заменившие последние PNG (/public/icons) и эмодзи ── */

/** Закрыть / крестик (вместо текстового «✕»). */
export function XIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </IconBase>
  );
}

/** Одиночная галка (отправлено / выбрано). */
export function CheckIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 13l4 4L19 7" />
    </IconBase>
  );
}

/** Двойная галка (прочитано). */
export function DoubleCheckIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M2.5 13l4 4L14 9.5" />
      <path d="M10 13.5l3.5 3.5L21.5 9" />
    </IconBase>
  );
}

/** Часы — отложенная отправка / ожидание. */
export function ClockIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </IconBase>
  );
}

/** Повторная отправка (стрелка по кругу). */
export function ResendIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M20 8a8 8 0 10.9 7" />
      <path d="M20 3v5h-5" />
    </IconBase>
  );
}

/** Звезда — избранное. */
export function StarIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9l-5.4 2.9 1.1-6.1L3.2 9.4l6.1-.8L12 3z" />
    </IconBase>
  );
}

/** Геометка (адрес / координаты). */
export function MapPinIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 21s-6.5-5.5-6.5-10a6.5 6.5 0 1113 0c0 4.5-6.5 10-6.5 10z" />
      <circle cx="12" cy="10.5" r="2.3" />
    </IconBase>
  );
}

/** Колокольчик с перечёркиванием — уведомления канала выключены. */
export function BellOffIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 9a6 6 0 0110-4.4M18 9c0 5 2 6 2 6H8" />
      <path d="M4 15s1.2-.6 1.8-3" />
      <path d="M10 18a2 2 0 004 0" />
      <path d="M4 4l16 16" />
    </IconBase>
  );
}

/** Сейф — избранная переписка с самим собой. */
export function VaultIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 10v2l1.4 1.4" />
      <path d="M7 20v1.5M17 20v1.5" />
    </IconBase>
  );
}

/** Пользователи / участники (вместо эмодзи «👥»). */
export function UsersIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="9" cy="8" r="2.5" />
      <circle cx="16" cy="9" r="2" />
      <path d="M4.5 18a4.5 4.5 0 019 0" />
      <path d="M13.5 18a3.5 3.5 0 017 0" />
    </IconBase>
  );
}

/** Скрепка — вложение (дублирует ConnectIconsExtra для единообразия импортов). */
export function AttachmentIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M21 12.5l-8.5 8.5a5.5 5.5 0 01-7.8-7.8L13 5a3.7 3.7 0 015.2 5.2l-8.2 8.2a1.8 1.8 0 01-2.6-2.6L15 8.3" />
    </IconBase>
  );
}

/** Раскрытая книга — словарь / чтение. */
export function BookOpenIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 6c-1.5-1.4-3.6-2-6-2H4v14h2c2.4 0 4.5.6 6 2 1.5-1.4 3.6-2 6-2h2V4h-2c-2.4 0-4.5.6-6 2z" />
      <path d="M12 6v14" />
    </IconBase>
  );
}

/** Добавить друга (вместо add-friend.png). */
export function UserPlusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="10" cy="8" r="3" />
      <path d="M4 19a6 6 0 0112 0" />
      <path d="M19 8v6" />
      <path d="M16 11h6" />
    </IconBase>
  );
}

/** Палитра — холст/рисование (вместо эмодзи «🎨»). */
export function PaletteIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3a9 9 0 100 18h1.5a2 2 0 001.4-3.4 2 2 0 011.4-3.4H19a3 3 0 003-3c0-4.6-4.5-8.2-10-8.2z" />
      <circle cx="7.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="10" r="1" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

/* ── FIX-PRV: мини-иконки ПРИВАТНЫХ каналов ─────────────────────────────
   Как в Discord: приватность встроена в сам значок канала, а не отдельный
   ключик рядом. Замок «врезан» в глиф: у чата — внутри пузыря, у голосового
   канала — поверх дуги микрофона. */

/** Приватный текстовый канал: пузырь сообщения с врезанным замком. */
export function PrivateChatIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 5h14a2 2 0 012 2v8a2 2 0 01-2 2H9l-4 3v-3H5a2 2 0 01-2-2V7a2 2 0 012-2z" />
      <rect x="9.6" y="10.2" width="4.8" height="3.6" rx="0.9" />
      <path d="M10.6 10.2V9.1a1.4 1.4 0 012.8 0v1.1" />
    </IconBase>
  );
}

/** Приватный голосовой канал: микрофон с замком в правом нижнем углу. */
export function PrivateVoiceIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0012 0" />
      <path d="M12 17v3" />
      <path d="M8 20h5" />
      <rect x="15.4" y="16.8" width="6.2" height="4.8" rx="1" />
      <path d="M16.9 16.8v-1.2a1.6 1.6 0 013.2 0v1.2" />
    </IconBase>
  );
}

/**
 * Кнопка «эмодзи»: контурная улыбка тем же стилем, что и остальные значки.
 *
 * Раньше на этой кнопке стоял сам эмодзи — цветной глиф. Рядом с контурными
 * значками он выпадал из ряда: жёлтое пятно не подчиняется ни `currentColor`,
 * ни наведению, ни теме. Значок кнопки должен вести себя как значок кнопки, а
 * эмодзи живут внутри — в том окне, которое она открывает.
 */
export function EmojiIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.4 14.2a4.4 4.4 0 007.2 0" />
      <path d="M9.2 9.6h.01" />
      <path d="M14.8 9.6h.01" />
    </IconBase>
  );
}
