-- PUSH: устройства для доставки уведомлений в закрытое приложение.
--
-- До этого уведомления показывались только пока приложение открыто: они
-- приходили живым соединением, и закрытый мессенджер молчал. Доставку в закрытое
-- приложение делает служба доставки сообщений телефона, а ей нужен адрес
-- конкретного устройства — он и хранится здесь.
--
-- Уникальность по токену, а не по паре «человек и токен»: на одном телефоне
-- может войти другой человек, и устройство должно перейти к нему целиком, иначе
-- прежний владелец продолжал бы получать чужие уведомления.
--
-- Идемпотентно: миграция может доехать на базу, где её часть уже применена.

CREATE TABLE IF NOT EXISTS "PushDevice" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "platform" VARCHAR(16) NOT NULL DEFAULT 'android',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PushDevice_token_key" ON "PushDevice"("token");
CREATE INDEX IF NOT EXISTS "PushDevice_userId_idx" ON "PushDevice"("userId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PushDevice_userId_fkey') THEN
    ALTER TABLE "PushDevice"
      ADD CONSTRAINT "PushDevice_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
