"use client";
import type { CommandDef } from "./slashCommandDefs";

interface Props {
  matches: CommandDef[];
  activeIndex: number;
  onPick: (cmd: CommandDef) => void;
  onHover: (idx: number) => void;
}

export default function SlashCommandPopup({ matches, activeIndex, onPick, onHover }: Props) {
  if (matches.length === 0) return null;
  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 rounded-xl border border-[var(--cn-border,rgba(0,0,0,0.08))] bg-[var(--cn-main)] shadow-xl z-30 overflow-hidden max-h-64 overflow-y-auto">
      <div className="px-3 py-1.5 text-[10px] text-neutral-400 uppercase tracking-wider font-semibold border-b border-[var(--cn-border,rgba(0,0,0,0.08))] flex items-center gap-1.5">
        <span>⌘</span>
        <span>Команды</span>
        <span className="ml-auto text-neutral-300">↑↓ выбор · Enter применить · Esc закрыть</span>
      </div>
      {matches.map((cmd, idx) => (
        <button
          key={cmd.name}
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onPick(cmd); }}
          onMouseEnter={() => onHover(idx)}
          className={`w-full text-left px-3 py-2 flex items-start gap-3 transition-colors ${
            idx === activeIndex
              ? "bg-violet-50 dark:bg-cyan-900/20"
              : "hover:bg-neutral-50 dark:hover:bg-white/5"
          }`}
        >
          <span className="mt-0.5 text-xs font-mono font-semibold text-violet-600 dark:text-cyan-400 w-32 shrink-0 truncate">
            /{cmd.name}
          </span>
          <span className="flex flex-col min-w-0">
            <span className="text-xs font-mono text-neutral-500 dark:text-neutral-400 truncate">{cmd.syntax}</span>
            <span className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug mt-0.5">{cmd.description}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
