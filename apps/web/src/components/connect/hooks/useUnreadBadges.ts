"use client";

import { useState, useCallback, useEffect, useRef } from "react";

/* REFACTOR-A: вынесено из app/connect/page.tsx без изменений логики.
   Бейджи непрочитанных сообщений и упоминаний по каналам + агрегация по
   сообществам (FIX-N2, FIX-NTF2). */
export function useUnreadBadges(selectedChannel: string | null) {
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [mentionChannels, setMentionChannels] = useState<Record<string, boolean>>({});
  // FIX-NTF2: канал → { groupId, name } — источник непрочитанных для списка сообществ
  const [unreadChannelInfo, setUnreadChannelInfo] = useState<Record<string, { groupId: string; name: string }>>({});

  /* ── FIX-N2: ответ поллинга не должен снова подсвечивать канал, открытый
        на экране: сервер мог ещё не обработать отметку о прочтении (гонка
        между fetchUnread и POST /api/messages/read). ── */
  const selectedChannelRef = useRef<string | null>(null);
  const fetchUnread = useCallback(() => {
    fetch("/api/channels/unread").then((r) => r.json()).then((data) => {
      const openId = document.hidden ? null : selectedChannelRef.current;
      if (data.unread) {
        const nextUnread = { ...data.unread };
        if (openId) delete nextUnread[openId];
        setUnreadCounts(nextUnread);
      }
      if (data.mentions) {
        const nextMentions = { ...data.mentions };
        if (openId) delete nextMentions[openId];
        setMentionChannels(nextMentions);
      }
      if (data.channels) setUnreadChannelInfo(data.channels); // FIX-NTF2
    }).catch(() => {});
  }, []);

  useEffect(() => { selectedChannelRef.current = selectedChannel; }, [selectedChannel]);

  // FIX-NTF2: агрегируем непрочитанные по сообществам — бейдж напротив группы
  // в списке показывает число сообщений, а тултип — из каких именно чатов.
  const groupUnread: Record<string, { count: number; mention: boolean; channels: string[] }> = {};
  for (const chId of Object.keys(unreadCounts)) {
    const cnt = unreadCounts[chId];
    if (!cnt) continue;
    const info = unreadChannelInfo[chId];
    if (!info) continue;
    const entry = groupUnread[info.groupId] ?? (groupUnread[info.groupId] = { count: 0, mention: false, channels: [] });
    entry.count += cnt;
    if (mentionChannels[chId]) entry.mention = true;
    entry.channels.push(`${info.name} (${cnt})`);
  }

  return { unreadCounts, setUnreadCounts, mentionChannels, setMentionChannels, fetchUnread, groupUnread };
}
