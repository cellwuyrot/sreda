-- Индексы под запросы, которые сейчас идут перебором таблицы.
--
-- Каждый из них закрывает конкретную выборку, а не «на всякий случай»:
--
--   GroupMember(groupId)          — участники сообщества: список, @everyone,
--                                   рассылки, счётчики. Составной уникальный
--                                   ключ начинается с userId и здесь не помогает.
--   ChannelMember(channelId)      — счётчик участников для каждого канала при
--                                   открытии сообщества.
--   Message(createdAt)            — сводка «сообщений за сутки» в админке.
--   Message(channelId, pinned)    — список закреплённых в канале.
--   DirectMessage(createdAt)      — та же сводка по личным сообщениям.
--   Notification(userId, createdAt) — лента уведомлений с сортировкой по дате.
--   CalendarEvent(channelId, start) — события канала по времени.
--
-- IF NOT EXISTS — чтобы миграция не падала на базе, где индекс уже создавали
-- руками. Создание индекса ненадолго блокирует запись в таблицу; на больших
-- Message и Notification это заметно, поэтому лучше выкатывать в тихий час
-- (см. docs/server-actions.md).

CREATE INDEX IF NOT EXISTS "GroupMember_groupId_idx" ON "GroupMember"("groupId");

CREATE INDEX IF NOT EXISTS "ChannelMember_channelId_idx" ON "ChannelMember"("channelId");

CREATE INDEX IF NOT EXISTS "Message_createdAt_idx" ON "Message"("createdAt");

CREATE INDEX IF NOT EXISTS "Message_channelId_pinned_idx" ON "Message"("channelId", "pinned");

CREATE INDEX IF NOT EXISTS "DirectMessage_createdAt_idx" ON "DirectMessage"("createdAt");

CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "CalendarEvent_channelId_start_idx" ON "CalendarEvent"("channelId", "start");
