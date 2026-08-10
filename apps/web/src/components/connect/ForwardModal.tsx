"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { ForwardTarget } from "./messageTypes";
import { ChatIcon } from "@/components/ui/ConnectIcons"; // FIX-ICONS

interface ForwardModalProps {
  forwardMsg: { content: string; userName: string } | null;
  search: string;
  onSearchChange: (v: string) => void;
  targets: ForwardTarget[];
  sending: boolean;
  onForward: (target: { type: "channel" | "dm"; id: string; name: string }) => void;
  onClose: () => void;
}

export default function ForwardModal({ forwardMsg, search, onSearchChange, targets, sending, onForward, onClose }: ForwardModalProps) {
  return (
      <AnimatePresence>
        {forwardMsg && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="w-80 max-h-[70vh] rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 shadow-2xl overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 pt-4 pb-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-neutral-900 dark:text-white">Переслать сообщение</span>
                  <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
                <div className="text-[11px] text-neutral-400 mb-2 truncate">от {forwardMsg.userName}: {forwardMsg.content.slice(0, 60)}{forwardMsg.content.length > 60 ? "..." : ""}</div>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Поиск канала или диалога..."
                  className="input-field !py-2 !text-sm w-full"
                  autoFocus
                />
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
                {targets
                  .filter(t => t.name.toLowerCase().includes(search.toLowerCase()))
                  .map(t => (
                    <button
                      key={`${t.type}-${t.id}`}
                      onClick={() => onForward(t)}
                      disabled={sending}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-violet-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
                    >
                      <span className="text-base flex-shrink-0 inline-flex items-center">{t.type === "channel" ? "#" : <ChatIcon size={16} />}</span>
                      <span className="text-sm text-neutral-900 dark:text-white truncate">{t.name}</span>
                      <span className="text-[10px] text-neutral-400 ml-auto flex-shrink-0">{t.type === "channel" ? "канал" : "ЛС"}</span>
                    </button>
                  ))}
                {targets.filter(t => t.name.toLowerCase().includes(search.toLowerCase())).length === 0 && (
                  <div className="text-center text-xs text-neutral-400 py-4">Ничего не найдено</div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
  );
}

