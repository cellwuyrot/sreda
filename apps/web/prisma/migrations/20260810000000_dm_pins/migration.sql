-- Закрепление сообщений в личной переписке.
--
-- Клиент умел закреплять с самого начала: кнопка в меню сообщения, список
-- закреплённых в шапке беседы. Но маршрута на сервере не было (запрос уходил
-- в /api/dm/pin и получал 404), а в таблице — полей. Закрепление жило только
-- в состоянии вкладки и пропадало при перезагрузке.
--
-- IF NOT EXISTS: миграция должна безопасно накатываться на базы, где колонки
-- могли появиться раньше через prisma db push.
ALTER TABLE "DirectMessage" ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DirectMessage" ADD COLUMN IF NOT EXISTS "pinnedAt" TIMESTAMP(3);
ALTER TABLE "DirectMessage" ADD COLUMN IF NOT EXISTS "pinnedById" TEXT;

-- Список закреплённых открывается в шапке беседы, поэтому выборка идёт по паре
-- «беседа + признак закрепления».
CREATE INDEX IF NOT EXISTS "DirectMessage_conversationId_pinned_idx"
  ON "DirectMessage" ("conversationId", "pinned");
