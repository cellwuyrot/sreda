"use client";

import GlowAvatar from "@/components/ui/GlowAvatar";
import { isOnline, timeAgo } from "@/lib/timeAgo";
import { isPaid, statusLabel, type PaymentStatus } from "@/lib/businessPayment";
import type { DMUser } from "./dmTypes";

interface DMMessageHeaderProps {
  other: DMUser;
  /**
   * Строка под именем вместо «Онлайн / Был(а) …».
   *
   * Нужна деловому разговору: собеседник там — администрация, её присутствие в
   * сети ничего не значит, а тема обращения и имя ведущего значат. «Был(а) 3 дня
   * назад» под словом «Администрация» вводило бы в заблуждение: это время
   * последнего входа случайного сотрудника, а не готовность отвечать.
   */
  subtitle?: string;
  e2eeReady: boolean;
  e2eeEnabled: boolean;
  showPinned: boolean;
  onToggleE2EE: () => void;
  onTogglePinned: () => void;
  onBack: () => void;
  /** FIX-DM: ПКМ по нику/аватару — меню действий с пользователем. */
  onUserMenu?: (e: React.MouseEvent) => void;
  /**
   * BUSINESS-PAY: состояние счёта по деловому разговору.
   *
   * null и undefined различаются намеренно:
   *   undefined — разговор не деловой, кнопки вообще нет;
   *   null      — разговор деловой, но счёт ещё не выставлен.
   * Во втором случае кнопка нужна: администрация через неё видит, что счёта нет,
   * а клиент — что платить пока не за что.
   */
  paymentStatus?: PaymentStatus | null;
  onOpenPayment?: () => void;
}

function HeaderButton({ active = false, label, onClick, children }: { active?: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`w-10 h-10 rounded-xl border inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:focus-visible:ring-cyan-400 ${active ? "bg-violet-500/15 dark:bg-cyan-400/15 border-violet-400/30 dark:border-cyan-400/30 text-violet-600 dark:text-cyan-300" : "bg-[var(--cn-card)] border-[var(--cn-border)] text-neutral-500 dark:text-neutral-400 hover:bg-[var(--cn-hover)] hover:text-neutral-800 dark:hover:text-white"}`}
    >
      {children}
    </button>
  );
}

export default function DMMessageHeader({ other, subtitle, e2eeReady, e2eeEnabled, showPinned, onToggleE2EE, onTogglePinned, onBack, onUserMenu, paymentStatus, onOpenPayment }: DMMessageHeaderProps) {
  const online = isOnline(other.lastSeen);
  /* Кнопка оплаты показывается только там, где есть обе части: и признак
     делового разговора, и обработчик. Иначе в личной переписке могла бы
     проскочить кнопка, ничего не делающая по нажатию. */
  const showPayment = paymentStatus !== undefined && !!onOpenPayment;
  const paid = isPaid(paymentStatus ?? "UNPAID");
  return (
    <header className="min-h-[64px] px-3 md:px-4 border-b border-[var(--cn-border)] bg-[var(--cn-sidebar)]/95 backdrop-blur-sm flex items-center gap-3 relative z-20">
      <button type="button" onClick={onBack} className="md:hidden min-w-[44px] min-h-[44px] rounded-xl border border-[var(--cn-border)] inline-flex items-center justify-center text-neutral-500 active:bg-[var(--cn-hover)]" aria-label="Назад к списку диалогов">
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
      </button>
      {/* FIX-DM: область ника и аватара открывает контекстное меню по ПКМ */}
      <div
        className="flex items-center gap-3 min-w-0 flex-1 cursor-context-menu"
        onContextMenu={onUserMenu}
        title="ПКМ — действия с пользователем"
      >
        <GlowAvatar user={other} size={38} onlineColor={online ? "green" : undefined} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-white truncate">{other.name}</h2>
            {!subtitle && (
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${online ? "bg-green-400" : "bg-neutral-400"}`} />
            )}
          </div>
          <p className="text-[11px] text-neutral-400 truncate">
            {subtitle ?? (online ? "Онлайн" : `Был(а) ${timeAgo(other.lastSeen)}`)}
          </p>
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {/* BUSINESS-PAY: плашка «Оплачено / Не оплачено» рядом с именем
            собеседника. Форма такая же, как у переключателя шифрования ниже
            (h-10 px-3 rounded-xl border) — шапка не должна разъезжаться на два
            разных вида кнопок. На узком экране остаётся только значок. */}
        {showPayment && (
          <button
            type="button"
            onClick={onOpenPayment}
            title={statusLabel(paymentStatus ?? "UNPAID")}
            aria-label={`Оплата: ${statusLabel(paymentStatus ?? "UNPAID")}`}
            className={`h-10 px-3 rounded-xl border inline-flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:focus-visible:ring-cyan-400 ${
              paid
                ? "bg-green-500/10 border-green-500/25 text-green-600 dark:text-green-400"
                : "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
            }`}
          >
            {paid ? (
              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m5 13 4 4L19 7" /></svg>
            ) : (
              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2" strokeWidth={2} /><path strokeLinecap="round" strokeWidth={2} d="M3 10h18" /></svg>
            )}
            <span className="hidden sm:inline text-[11px] font-medium">{statusLabel(paymentStatus ?? "UNPAID")}</span>
          </button>
        )}
        <HeaderButton active={showPinned} label="Закреплённые сообщения" onClick={onTogglePinned}>
          <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3h6l1 7 2 2H6l2-2 1-7ZM12 12v9"/></svg>
        </HeaderButton>
        {e2eeReady && (
          <button type="button" onClick={onToggleE2EE} title={e2eeEnabled ? "Шифрование включено" : "Перейти в защищённый режим"} className={`h-10 px-3 rounded-xl border inline-flex items-center gap-2 transition-colors ${e2eeEnabled ? "bg-green-500/10 border-green-500/25 text-green-600 dark:text-green-400" : "bg-[var(--cn-card)] border-[var(--cn-border)] text-neutral-500 dark:text-neutral-400 hover:bg-[var(--cn-hover)]"}`}>
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2" strokeWidth={2}/><path strokeLinecap="round" strokeWidth={2} d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
            <span className="hidden sm:inline text-[11px] font-medium">{e2eeEnabled ? "Защищённый" : "Открытый"}</span>
          </button>
        )}
      </div>
    </header>
  );
}
