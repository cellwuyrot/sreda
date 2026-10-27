"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Search, Phone, Video, Info, MoreHorizontal, Pin, Lock } from "lucide-react";
import GlowAvatar from "@/components/ui/GlowAvatar";
import { isOnline, timeAgo } from "@/lib/timeAgo";
import { useCall } from "@/components/call/CallProvider";
import type { DMUser } from "./dmTypes";
const button = "min-w-11 h-11 inline-flex items-center justify-center rounded-lg text-[var(--cn-muted)] hover:bg-[var(--cn-hover)] focus-visible:ring-2 focus-visible:ring-violet-500 dark:focus-visible:ring-cyan-400";
export default function DMPersonalHeader({ other, secure, vault, onBack, onSearch, onMaterials, onPins, onSecure, onSettings, onError }: {
  other: DMUser; secure: boolean; vault: boolean; onBack: () => void; onSearch: () => void;
  onMaterials: () => void; onPins: () => void; onSecure: () => void; onSettings: (e: React.MouseEvent) => void; onError: (s: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), first = useRef<HTMLButtonElement>(null);
  const { startCall, callSupported, state } = useCall();
  const busy = state.phase !== "idle";
  useEffect(() => {
    if (!menu) return;
    first.current?.focus();
    const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setMenu(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [menu]);
  const dial = async (video: boolean) => {
    setMenu(false);
    if (secure) { onError("Звонок использует отдельный сервис, а не шифрование переписки. Перейдите в обычный разговор для звонка."); return; }
    const result = await startCall({ userId: other.id, userName: other.name, avatar: other.avatar }, video);
    if (!result.ok) onError(result.error || "Звонок недоступен");
  };
  const action = (fn: () => void) => { setMenu(false); fn(); };
  return <header className="min-h-[72px] px-2 md:px-4 border-b border-[var(--cn-border)] bg-[var(--cn-sidebar)] flex items-center gap-2 relative z-30">
    <button type="button" onClick={onBack} className={`${button} md:hidden`} aria-label="Назад к диалогам"><ArrowLeft size={19}/></button>
    <GlowAvatar user={other} size={36} onlineColor={isOnline(other.lastSeen) ? "green" : undefined}/>
    <div className="flex-1 min-w-0"><h2 className="font-semibold text-base truncate">{other.name}</h2><p className="text-sm text-[var(--cn-muted)] truncate">{secure ? "Защищённая переписка · только текст" : vault ? "Сохранённые материалы" : isOnline(other.lastSeen) ? "Онлайн" : `Был(а) ${timeAgo(other.lastSeen)}`}</p></div>
    {!secure && <button type="button" className={button} aria-label="Поиск в переписке" title="Поиск в переписке" onClick={onSearch}><Search size={19}/></button>}
    {!vault && !secure && callSupported && <div className="hidden xl:flex"><button type="button" className={button} aria-label="Аудиозвонок" title="Аудиозвонок" disabled={busy} onClick={() => void dial(false)}><Phone size={19}/></button><button type="button" className={button} aria-label="Видеозвонок" title="Видеозвонок" disabled={busy} onClick={() => void dial(true)}><Video size={19}/></button></div>}
    {!secure && <button type="button" className={`${button} hidden sm:inline-flex`} aria-label="Материалы чата" title="Материалы чата" onClick={onMaterials}><Info size={19}/></button>}
    <div ref={root} className="relative"><button ref={trigger} type="button" className={button} aria-label="Ещё действия" aria-expanded={menu} onClick={() => setMenu(v => !v)}><MoreHorizontal size={20}/></button>
      {menu && <div className="absolute right-0 top-full mt-1 w-64 max-w-[calc(100vw-24px)] p-2 rounded-xl border border-[var(--cn-border)] bg-[var(--cn-sidebar)] shadow-xl text-sm">
        <p className="p-2 text-xs text-[var(--cn-muted)] border-b border-[var(--cn-border)]">{secure ? "Защищённая переписка. Автоудаления нет." : "Обычная переписка · без E2EE"}</p>
        <button ref={first} type="button" className="min-h-11 w-full flex items-center gap-2 px-2 rounded-lg hover:bg-[var(--cn-hover)]" onClick={() => action(onPins)}><Pin size={17}/>Закреплённые</button>
        {!secure && <button type="button" className="min-h-11 w-full flex items-center gap-2 px-2 rounded-lg hover:bg-[var(--cn-hover)]" onClick={() => action(onMaterials)}><Info size={17}/>Материалы чата</button>}
        {!vault && !secure && callSupported && <div className="xl:hidden"><button type="button" className="min-h-11 w-full flex items-center gap-2 px-2 disabled:opacity-50" disabled={busy} onClick={() => void dial(false)}><Phone size={17}/>Аудиозвонок</button><button type="button" className="min-h-11 w-full flex items-center gap-2 px-2 disabled:opacity-50" disabled={busy} onClick={() => void dial(true)}><Video size={17}/>Видеозвонок</button></div>}
        {!vault && <button type="button" className="min-h-11 w-full flex items-center gap-2 px-2" onClick={() => action(onSecure)}><Lock size={17}/>{secure ? "Обычная переписка" : "Защищённая переписка"}</button>}
        {!secure && !vault && <button type="button" className="min-h-11 w-full flex items-center gap-2 px-2" onClick={e => { setMenu(false); onSettings(e); }}><MoreHorizontal size={17}/>Настройки собеседника</button>}
      </div>}
    </div>
  </header>;
}
