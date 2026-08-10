"use client";

import type { Channel } from "./sidebarTypes";
import { ChatIcon, PrivateChatIcon, PrivateVoiceIcon, VoiceChannelIcon, BellOffIcon } from "@/components/ui/ConnectIcons"; // FIX-ICONS

export function ChannelItem({ ch, selectedChannel, unreadCounts, mentionChannels = {}, canManage, onChannelClick, onDeleteChannel, onEditChannel, isMuted, onToggleMute }: {
  ch: Channel;
  selectedChannel: string | null;
  unreadCounts: Record<string, number>;
  mentionChannels?: Record<string, boolean>;
  canManage: boolean;
  onChannelClick: (channel: Channel) => void;
  onDeleteChannel: (channelId: string) => void;
  onEditChannel?: (channel: Channel) => void;
  isMuted?: boolean;
  onToggleMute?: (channelId: string, muted: boolean) => void;
}) {
  return (
    <div className="group flex items-center">
      <button
        onClick={() => {
          if (selectedChannel === ch.id && canManage && onEditChannel) {
            onEditChannel(ch);
          } else {
            onChannelClick(ch);
          }
        }}
        className={`cn-channel-btn flex-1 text-left px-2.5 py-1.5 rounded-lg flex items-center gap-2 transition-all text-sm ${
          selectedChannel === ch.id ? "active" : ""
        }`}
        aria-current={selectedChannel === ch.id ? "page" : undefined}
      >
        <span className="text-base flex items-center" title={ch.isRestricted ? "Приватный канал — доступ по ролям" : undefined}>
          {/* FIX-PRV: у приватного канала собственная мини-иконка со встроенным замком */}
          {ch.isRestricted ? (
            ch.type === "VOICE" ? (
              <PrivateVoiceIcon size={18} tone="inactive" />
            ) : (
              <PrivateChatIcon size={18} tone="inactive" />
            )
          ) : ch.type === "VOICE" ? (
            <VoiceChannelIcon size={18} tone="inactive" />
          ) : ch.icon ? (
            ch.icon
          ) : (
            <ChatIcon size={18} tone="inactive" />
          )}
        </span>
        <span className="truncate flex-1">{ch.name}</span>
        {isMuted && <span className="flex items-center opacity-50" title="Уведомления отключены"><BellOffIcon size={16} style={{ color: "inherit" }} /></span>}
        {(unreadCounts[ch.id] ?? 0) > 0 && (
          mentionChannels[ch.id] ? (
            <span className="ml-auto w-2 h-2 rounded-full bg-red-500 flex-shrink-0" title="Вас упомянули" />
          ) : (
            <span className="ml-auto w-2 h-2 rounded-full bg-neutral-400 dark:bg-white flex-shrink-0" title="Непрочитано" />
          )
        )}
      </button>
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
        {onToggleMute && (
          <button
            onClick={() => onToggleMute(ch.id, !isMuted)}
            className="p-1 text-neutral-400 hover:text-violet-500 dark:hover:text-cyan-400 transition-colors"
            aria-label={isMuted ? "Включить уведомления" : "Отключить уведомления"}
            title={isMuted ? "Включить уведомления" : "Отключить уведомления"}
          >
            <BellOffIcon size={16} className={isMuted ? "opacity-50" : ""} style={{ color: "inherit" }} />
          </button>
        )}

        {canManage && onEditChannel && (
          <button
            onClick={() => onEditChannel(ch)}
            className="p-1 text-neutral-400 hover:text-violet-500 dark:hover:text-cyan-400 transition-colors"
            aria-label={`Настройки канала ${ch.name}`}
            title="Настройки канала"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}
        {canManage && (
          <button
            onClick={() => onDeleteChannel(ch.id)}
            className="p-1 text-neutral-400 hover:text-red-500 transition-colors"
            aria-label={`Delete ${ch.name}`}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */