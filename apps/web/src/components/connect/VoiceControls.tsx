"use client";

import { type ReactNode } from "react";
import AudioBars from "@/components/ui/AudioBars";
import { ScreenShareIcon } from "./voiceIcons";

// FIX-MUTEICONS: 4 варианта значка заглушки на аватаре:
// 1. Сам заглушил микрофон           → красный микрофон
// 2. Сам заглушил мик+наушники       → красный мик + красные наушники
// 3. Модератор заглушил микрофон     → чёрный микрофон
// 4. Модератор заглушил мик+наушники → чёрный мик + чёрные наушники

function MicIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="9" y1="22" x2="15" y2="22" />
    </svg>
  );
}

function HeadphonesIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" />
      <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  );
}

/**
 * Значок заглушки на аватаре участника голосового канала.
 *
 * Логика отображения:
 * - isForceDeafened  → чёрный мик + чёрные наушники (принудительно мод.)
 * - isForceMuted     → чёрный мик (принудительно мод., только мик)
 * - isDeafened       → красный мик + красные наушники (сам заглушил)
 * - muted            → красный мик (сам заглушил)
 */
function MuteBadge({
  muted,
  isDeafened,
  isForceMuted,
  isForceDeafened,
}: {
  muted: boolean;
  isDeafened: boolean;
  isForceMuted: boolean;
  isForceDeafened: boolean;
}) {
  if (!muted && !isForceMuted && !isDeafened && !isForceDeafened) return null;

  // Принудительная заглушка мик + наушники (чёрный)
  if (isForceDeafened) {
    return (
      <div className="absolute -bottom-0.5 -right-0.5 flex items-center gap-[1px]">
        <div className="w-3 h-3" title="Заглушён модератором (мик+наушники)">
          <MicIcon color="#1a1a1a" />
        </div>
        <div className="w-3 h-3">
          <HeadphonesIcon color="#1a1a1a" />
        </div>
      </div>
    );
  }

  // Принудительная заглушка только мик (чёрный)
  if (isForceMuted) {
    return (
      <div
        className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5"
        title="Заглушён модератором"
      >
        <MicIcon color="#1a1a1a" />
      </div>
    );
  }

  // Сам заглушил мик + наушники (красный)
  if (isDeafened) {
    return (
      <div className="absolute -bottom-0.5 -right-0.5 flex items-center gap-[1px]">
        <div className="w-3 h-3" title="Заглушены мик+наушники">
          <MicIcon color="#ef4444" />
        </div>
        <div className="w-3 h-3">
          <HeadphonesIcon color="#ef4444" />
        </div>
      </div>
    );
  }

  // Сам заглушил только мик (красный)
  if (muted) {
    return (
      <div
        className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5"
        title="Микрофон заглушён"
      >
        <MicIcon color="#ef4444" />
      </div>
    );
  }

  return null;
}

export function VoiceUserRow({
  name,
  muted,
  speaking,
  isLocal,
  quality,
  sharingScreen = false,
  avatar,
  isDeafened = false,
  isForceMuted = false,
  isForceDeafened = false,
}: {
  name: string;
  muted: boolean;
  speaking: boolean;
  isLocal?: boolean;
  quality?: "good" | "medium" | "poor" | "unknown";
  sharingScreen?: boolean;
  /** FIX-VAVATAR: аватар участника */
  avatar?: string | null;
  /** FIX-MUTEICONS: пользователь заглушил наушники сам */
  isDeafened?: boolean;
  /** FIX-MUTEICONS: принудительно заглушен модератором (мик) */
  isForceMuted?: boolean;
  /** FIX-MUTEICONS: принудительно заглушен модератором (мик+наушники) */
  isForceDeafened?: boolean;
}) {
  const qColor =
    quality === "good"
      ? "bg-green-400"
      : quality === "medium"
      ? "bg-yellow-400"
      : quality === "poor"
      ? "bg-red-400"
      : "bg-neutral-500";

  return (
    <div className="h-8 flex items-center gap-2 px-1 rounded group/row hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors">
      <div className="relative">
        <div
          className={`w-6 h-6 rounded-full overflow-hidden flex items-center justify-center text-[10px] font-bold transition-all ${
            speaking
              ? "bg-green-400/20 text-green-600 dark:text-green-400 ring-2 ring-green-400"
              : "bg-neutral-200 dark:bg-white/10 text-neutral-600 dark:text-neutral-400"
          }`}
        >
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" width={24} height={24} className="w-full h-full object-cover" />
          ) : (
            name.charAt(0).toUpperCase()
          )}
        </div>
        <MuteBadge
          muted={muted}
          isDeafened={isDeafened}
          isForceMuted={isForceMuted}
          isForceDeafened={isForceDeafened}
        />
      </div>
      <span
        className={`text-[12px] leading-4 font-medium truncate flex-1 ${
          speaking
            ? "text-green-600 dark:text-green-400"
            : "text-neutral-600 dark:text-neutral-400"
        }`}
      >
        {name}{isLocal ? " (Вы)" : ""}
      </span>
      {sharingScreen && (
        <span
          className="w-5 h-5 rounded-md bg-blue-500/15 text-blue-500 dark:text-cyan-300 inline-flex items-center justify-center flex-shrink-0"
          title="Демонстрирует экран"
        >
          <ScreenShareIcon />
        </span>
      )}
      {quality && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${qColor}`} />}
      <span className="w-[13px] h-[10px] flex-shrink-0 inline-flex items-center justify-end">
        {speaking && <AudioBars bars={3} color="bg-green-400" maxH={10} />}
      </span>
    </div>
  );
}

// FIX-RESTORE: VoiceControlBtn и VoiceOccupantsStrip были потеряны
// при перезаписи файла — восстанавливаем из контекста использования.

/**
 * Кнопка управления голосовым каналом (мьют, звук, шумодав, демонстрация, выход).
 * active + color="red"   → красный фон (активный / нежелательный режим)
 * active + color="green" → зелёный фон (активная функция)
 */
export function VoiceControlBtn({
  active = false,
  color = "red",
  onClick,
  title,
  disabled = false,
  children,
}: {
  active?: boolean;
  color?: "red" | "green";
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const base =
    "w-9 h-9 rounded-xl flex items-center justify-center transition-all flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:focus-visible:ring-cyan-400";

  const colorClass = active
    ? color === "red"
      ? "bg-red-500/20 text-red-500 hover:bg-red-500/30"
      : "bg-green-500/20 text-green-500 dark:text-green-400 hover:bg-green-500/30"
    : "bg-neutral-100 dark:bg-white/8 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-white/12";

  const disabledClass = disabled ? "opacity-40 pointer-events-none" : "";

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${colorClass} ${disabledClass}`}
    >
      <span className="w-5 h-5 inline-flex items-center justify-center">
        {children}
      </span>
    </button>
  );
}

/**
 * Компактная полоска аватаров участников голосового канала.
 * Используется в превью голосовых каналов.
 */
export function VoiceOccupantsStrip({
  users,
  max = 5,
}: {
  users: Array<{ userId: string; userName: string; avatar?: string | null }>;
  max?: number;
}) {
  const visible = users.slice(0, max);
  const extra = users.length - max;
  return (
    <div className="flex items-center -space-x-1">
      {visible.map((u) => (
        <div
          key={u.userId}
          className="w-5 h-5 rounded-full bg-neutral-200 dark:bg-white/10 overflow-hidden flex items-center justify-center text-[9px] font-bold text-neutral-600 dark:text-neutral-300 ring-1 ring-white dark:ring-neutral-900 flex-shrink-0"
          title={u.userName}
        >
          {u.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={u.avatar} alt="" width={20} height={20} className="w-full h-full object-cover" />
          ) : (
            u.userName.charAt(0).toUpperCase()
          )}
        </div>
      ))}
      {extra > 0 && (
        <div className="w-5 h-5 rounded-full bg-neutral-200 dark:bg-white/10 flex items-center justify-center text-[9px] font-bold text-neutral-500 ring-1 ring-white dark:ring-neutral-900 flex-shrink-0">
          +{extra}
        </div>
      )}
    </div>
  );
}
