"use client";

import { type ReactNode } from "react";
import AudioBars from "@/components/ui/AudioBars";
import { ScreenShareIcon } from "./voiceIcons";

export function VoiceUserRow({ name, muted, speaking, isLocal, quality, sharingScreen = false, avatar }: {
  name: string; muted: boolean; speaking: boolean; isLocal?: boolean; quality?: "good" | "medium" | "poor" | "unknown"; sharingScreen?: boolean;
  /** FIX-VAVATAR: аватар участника голосового канала; без него — буква имени. */
  avatar?: string | null;
}) {
  const qColor = quality === "good" ? "bg-green-400" : quality === "medium" ? "bg-yellow-400" : quality === "poor" ? "bg-red-400" : "bg-neutral-500";
  return (
    <div className="h-8 flex items-center gap-2 px-1 rounded group/row hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors">
      <div className="relative">
        <div className={`w-6 h-6 rounded-full overflow-hidden flex items-center justify-center text-[10px] font-bold transition-all ${
          speaking
            ? "bg-green-400/20 text-green-600 dark:text-green-400 ring-2 ring-green-400"
            : "bg-neutral-200 dark:bg-white/10 text-neutral-600 dark:text-neutral-400"
        }`}>
          {/* FIX-VAVATAR: раньше всегда была только первая буква имени, хотя аватар
              приходит вместе с данными о присутствии. */}
          {avatar ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={avatar} alt="" width={24} height={24} className="w-full h-full object-cover" />
          ) : (
            name.charAt(0).toUpperCase()
          )}
        </div>
        {muted && (
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-400 flex items-center justify-center">
            <svg className="w-2 h-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6" />
            </svg>
          </div>
        )}
      </div>
      <span className={`text-[12px] leading-4 font-medium truncate flex-1 ${
        speaking ? "text-green-600 dark:text-green-400" : "text-neutral-600 dark:text-neutral-400"
      }`}>
        {name}{isLocal ? " (Вы)" : ""}
      </span>
      {sharingScreen && <span className="w-5 h-5 rounded-md bg-blue-500/15 text-blue-500 dark:text-cyan-300 inline-flex items-center justify-center flex-shrink-0" title="Демонстрирует экран"><ScreenShareIcon /></span>}
      {quality && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${qColor}`} />}
      <span className="w-[13px] h-[10px] flex-shrink-0 inline-flex items-center justify-end">
        {speaking && <AudioBars bars={3} color="bg-green-400" maxH={10} />}
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Voice occupants strip (FIX-VAVATAR)

   Компактная полоска аватарок под названием голосового канала внутри группы
   каналов. Развёрнутый список с регулировкой громкости остаётся только у каналов без
   группы: внутри группы колонка уже со своим отступом. */
export function VoiceOccupantsStrip({ users, max = 6 }: {
  users: Array<{ socketId: string; userName: string; avatar?: string | null }>;
  max?: number;
}) {
  if (users.length === 0) return null;
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <div className="ml-9 mb-1 flex items-center gap-1" title={users.map((u) => u.userName).join(", ")}>
      {shown.map((u) => (
        <span
          key={u.socketId}
          className="w-5 h-5 rounded-full overflow-hidden flex items-center justify-center bg-neutral-200 dark:bg-white/10 text-[9px] font-bold text-neutral-600 dark:text-neutral-300"
        >
          {u.avatar ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={u.avatar} alt="" width={20} height={20} className="w-full h-full object-cover" />
          ) : (
            u.userName.charAt(0).toUpperCase()
          )}
        </span>
      ))}
      {rest > 0 && <span className="text-[10px] text-neutral-500 dark:text-neutral-400">+{rest}</span>}
    </div>
  );
}

/*  Voice Control Button                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function VoiceControlBtn({ onClick, active, color, title, children, disabled }: {
  onClick: () => void; active: boolean; color: "red" | "green"; title: string; children: ReactNode; disabled?: boolean;
}) {
  const cls = active
    ? color === "red"
      ? "bg-red-500/15 border-red-500/30 text-red-500"
      : "bg-green-500/15 border-green-500/30 text-green-500 dark:text-green-400"
    : "bg-neutral-100 dark:bg-white/[0.06] border-neutral-200 dark:border-white/10 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-white/10";
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`w-9 h-9 shrink-0 inline-flex items-center justify-center rounded-xl border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}
    >
      {children}
    </button>
  );
}

/* ── Icons ── */

