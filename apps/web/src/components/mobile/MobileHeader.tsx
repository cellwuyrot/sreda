"use client";

interface MobileHeaderProps {
  title: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
}

export default function MobileHeader({ title, onBack, rightAction }: MobileHeaderProps) {
  return (
    <header className="flex items-center gap-2 px-3 py-3 border-b border-neutral-200 dark:border-white/5 bg-white dark:bg-neutral-950 flex-shrink-0">
      {onBack && (
        <button
          onClick={onBack}
          className="p-1.5 -ml-1 rounded-lg text-neutral-500 dark:text-neutral-400 active:bg-neutral-100 dark:active:bg-white/5 transition-colors"
          aria-label="Назад"
        >
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}
      <h1 className="text-base font-semibold text-neutral-900 dark:text-white truncate flex-1">{title}</h1>
      {rightAction && <div className="flex-shrink-0">{rightAction}</div>}
    </header>
  );
}
