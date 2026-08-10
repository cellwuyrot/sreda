"use client";

import { motion, AnimatePresence } from "framer-motion";
import GlowAvatar from "@/components/ui/GlowAvatar";
import { renderContent } from "@/components/connect/messageFormat";
import type { Message } from "./dmTypes";

interface DMThreadPanelProps {
  activeThread: { id: string; user: string; content: string } | null;
  threadMessages: Message[];
  threadInput: string;
  onThreadInputChange: (v: string) => void;
  onSendThreadReply: () => void;
  onClose: () => void;
}

export default function DMThreadPanel({
  activeThread,
  threadMessages,
  threadInput,
  onThreadInputChange,
  onSendThreadReply,
  onClose,
}: DMThreadPanelProps) {
  return (
    <AnimatePresence>
      {activeThread && (
        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="absolute right-0 top-0 bottom-0 w-80 max-md:w-full bg-[var(--cn-sidebar)] border-l border-[var(--cn-border)] flex flex-col z-30 shadow-xl"
        >
          <div className="p-3 border-b border-[var(--cn-border)] flex items-center gap-2">
            <span className="font-medium text-sm text-neutral-800 dark:text-white flex-1 truncate">
              Тред: {activeThread.user}
            </span>
            <button
              onClick={onClose}
              className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white"
              aria-label="Закрыть тред"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-3 border-b border-[var(--cn-border)] bg-[var(--cn-accent-dim)]">
            <p className="text-xs text-neutral-600 dark:text-gray-400">{activeThread.content}</p>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {threadMessages.length === 0 ? (
              <p className="text-xs text-neutral-400 text-center py-4">Нет ответов в треде</p>
            ) : (
              threadMessages.map((tm) => (
                <div key={tm.id} className="flex gap-2">
                  <GlowAvatar user={tm.user} size={24} />
                  <div className="min-w-0">
                    <span className="text-xs font-medium text-neutral-800 dark:text-white">{tm.user.name}</span>
                    <p className="text-xs text-neutral-600 dark:text-gray-300 mt-0.5 break-words">
                      {renderContent(tm.content)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="p-3 border-t border-[var(--cn-border)]">
            <div className="flex gap-2">
              <input
                value={threadInput}
                onChange={(e) => onThreadInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onSendThreadReply();
                  }
                }}
                placeholder="Ответить в треде..."
                className="input-field flex-1 !py-2 text-sm"
                autoFocus
              />
              <button
                onClick={onSendThreadReply}
                disabled={!threadInput.trim()}
                className="btn-primary !px-3 !py-2 text-sm disabled:opacity-50"
                aria-label="Отправить ответ"
              >
                →
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
