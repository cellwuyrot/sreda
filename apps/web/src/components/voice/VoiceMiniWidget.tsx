"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useVoice } from "@/contexts/VoiceContext";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";

export default function VoiceMiniWidget() {
  const voice = useVoice();
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(true);

  // Only show when connected AND not on Connect page (Connect has its own UI)
  if (!voice.isConnected || pathname === "/connect") return null;

  const sharerNames = voice.screenShares.map(s => s.isLocal ? "Вы" : s.userName);
  const screenSharer = sharerNames.length === 0
    ? null
    : sharerNames.length <= 2
      ? sharerNames.join(", ")
      : `${sharerNames.slice(0, 2).join(", ")} +${sharerNames.length - 2}`;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 50, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 50, scale: 0.9 }}
        className="fixed bottom-4 right-4 z-50"
        style={{ maxWidth: expanded ? 280 : 52 }}
      >
        {expanded ? (
          <div className="bg-neutral-900/95 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className={`flex items-center justify-between px-3 py-2 border-b border-white/10 ${
              voice.voiceStatus === "connected" ? "bg-green-600/20" :
              voice.voiceStatus === "connecting" ? "bg-yellow-600/20" :
              voice.voiceStatus === "reconnecting" ? "bg-orange-600/20" :
              "bg-red-600/20"
            }`}>
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 animate-pulse ${
                  voice.voiceStatus === "connected" ? "bg-green-400" :
                  voice.voiceStatus === "connecting" ? "bg-yellow-400" :
                  voice.voiceStatus === "reconnecting" ? "bg-orange-400" :
                  "bg-red-400"
                }`} />
                <span className={`text-xs font-medium truncate ${
                  voice.voiceStatus === "connected" ? "text-green-400" :
                  voice.voiceStatus === "connecting" ? "text-yellow-400" :
                  voice.voiceStatus === "reconnecting" ? "text-orange-400" :
                  "text-red-400"
                }`}>
                  {voice.voiceStatus === "connecting" ? "Подключение..." :
                   voice.voiceStatus === "reconnecting" ? "Переподключение..." :
                   voice.channelName || "Голосовой"}
                </span>
                {voice.voiceStatus === "connected" && (
                  <span className="text-[10px] text-neutral-400">
                    {voice.users.length}
                  </span>
                )}
                {voice.localPing !== null && voice.voiceStatus === "connected" && (
                  <span className={`text-[9px] ${voice.localPing < 150 ? "text-green-400" : voice.localPing < 400 ? "text-yellow-400" : "text-red-400"}`}>
                    {Math.round(voice.localPing)}ms
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => setExpanded(false)}
                  className="p-1 hover:bg-white/10 rounded text-neutral-400 hover:text-white transition-colors"
                  title="Свернуть"
                >
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <Link
                  href="/connect"
                  className="p-1 hover:bg-white/10 rounded text-neutral-400 hover:text-white transition-colors"
                  title="Открыть Connect"
                >
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                  </svg>
                </Link>
              </div>
            </div>

            {/* Users */}
            <div className="px-2 py-1.5 max-h-40 overflow-y-auto space-y-0.5">
              {voice.users.map(u => {
                const isSpeaking = voice.speakingUsers.has(u.socketId) ||
                  (u.socketId === voice.users.find(vu => vu.userId === u.userId)?.socketId && voice.localSpeaking && u.userId === voice.users[0]?.userId);

                return (
                  <div
                    key={u.socketId}
                    className="flex items-center gap-2 px-1.5 py-1 rounded-lg"
                  >
                    {/* Avatar circle with speaking indicator */}
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 transition-all ${
                        isSpeaking
                          ? "bg-green-500/30 ring-2 ring-green-400 text-green-300"
                          : "bg-white/10 text-neutral-300"
                      }`}
                    >
                      {u.userName.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-xs text-neutral-200 truncate flex-1">{u.userName}</span>
                    {/* Quality dot */}
                    {(() => {
                      const q = voice.connectionQuality.get(u.socketId);
                      const color = q === "good" ? "bg-green-400" : q === "medium" ? "bg-yellow-400" : q === "poor" ? "bg-red-400" : "bg-neutral-500";
                      return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />;
                    })()}
                    {u.muted && (
                      <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-red-400 flex-shrink-0">
                        <line x1="1" y1="1" x2="23" y2="23" />
                        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                        <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .28-.02.56-.06.84" />
                        <line x1="12" y1="19" x2="12" y2="23" />
                        <line x1="8" y1="23" x2="16" y2="23" />
                      </svg>
                    )}
                    {/* Screen share indicator */}
                    {voice.screenSharerIds.has(u.socketId) && (
                      <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-blue-400 flex-shrink-0">
                        <rect x="2" y="3" width="20" height="14" rx="2" />
                        <line x1="8" y1="21" x2="16" y2="21" />
                        <line x1="12" y1="17" x2="12" y2="21" />
                      </svg>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Screen share preview */}
            {screenSharer && (
              <div className="px-2 pb-1.5">
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-1.5 flex items-center gap-2">
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-blue-400 flex-shrink-0">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                  <span className="text-[10px] text-blue-300 truncate">{screenSharer} {voice.screenShares.length > 1 ? "демонстрируют экраны" : "демонстрирует экран"}</span>
                </div>
              </div>
            )}

            {/* Controls */}
            <div className="flex items-center justify-between px-3 py-2 border-t border-white/10">
              <div className="flex gap-1">
                <button
                  onClick={voice.toggleMute}
                  className={`p-1.5 rounded-lg transition-colors ${
                    voice.isMuted ? "bg-red-500/20 text-red-400" : "bg-white/5 text-neutral-300 hover:bg-white/10"
                  }`}
                  title={voice.isMuted ? "Включить микрофон" : "Выключить микрофон"}
                >
                  {voice.isMuted ? (
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <line x1="1" y1="1" x2="23" y2="23" />
                      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .28-.02.56-.06.84" />
                    </svg>
                  ) : (
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={voice.toggleDeafen}
                  className={`p-1.5 rounded-lg transition-colors ${
                    voice.isDeafened ? "bg-red-500/20 text-red-400" : "bg-white/5 text-neutral-300 hover:bg-white/10"
                  }`}
                  title={voice.isDeafened ? "Включить звук" : "Отключить звук"}
                >
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    {voice.isDeafened ? (
                      <>
                        <path d="M16.5 12.5l-5 5" />
                        <path d="M11.5 12.5l5 5" />
                        <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                      </>
                    ) : (
                      <>
                        <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                      </>
                    )}
                  </svg>
                </button>
              </div>
              <button
                onClick={voice.leaveVoice}
                className="p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                title="Покинуть канал"
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M16 8l-8 8M8 8l8 8" />
                </svg>
              </button>
            </div>
          </div>
        ) : (
          /* Collapsed pill */
          <button
            onClick={() => setExpanded(true)}
            className="w-12 h-12 rounded-full bg-green-600/90 backdrop-blur-md border border-green-400/30 shadow-lg flex items-center justify-center hover:bg-green-600 transition-colors group"
            title="Голосовой канал"
          >
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-white">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-400 text-[8px] font-bold text-black flex items-center justify-center">
              {voice.users.length}
            </span>
          </button>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
