-- Уведомление знает, о КОМ оно и О ЧЁМ, плюс блокировка отправки в деловом чате.
--
-- Зачем `actorId`: у уведомления оставался только замороженный текст, поэтому
-- после удаления аккаунта уведомление о нём продолжало висеть в колокольчике.
-- Каскад убирает такие записи вместе с человеком.
--
-- Зачем `entityType`/`entityId`: «прочитано» вычислялось сопоставлением ТЕКСТА
-- ссылки, а у обращений ссылка ведёт в раздел, а не в заявку — сопоставить было
-- нечего, и прочитанное обращение навсегда оставалось непрочитанным уведомлением.
--
-- Зачем `locked` у разговора: игнорировать клиента в деловом чате нельзя —
-- чёрного списка там нет (сторона — администрация), а закрытие заявки отправку
-- не запрещало.
--
-- Идемпотентно: миграция может доехать на базу, где её часть уже применена.

ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "actorId" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "entityType" VARCHAR(32);
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "entityId" TEXT;

-- Каскад именно на уровне базы: удаление аккаунта идёт разными путями (админка,
-- самостоятельное удаление), и полагаться на то, что каждый из них не забудет
-- про уведомления, нельзя.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Notification_actorId_fkey'
  ) THEN
    ALTER TABLE "Notification"
      ADD CONSTRAINT "Notification_actorId_fkey"
      FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Notification_userId_entityType_entityId_idx"
  ON "Notification"("userId", "entityType", "entityId");
CREATE INDEX IF NOT EXISTS "Notification_actorId_idx" ON "Notification"("actorId");

-- Прежние записи остаются без предмета: восстановить его по тексту ссылки нельзя
-- честно, а гадать — значит погасить не то. Они гасятся по-прежнему, по ссылке;
-- новые — по предмету.

ALTER TABLE "DirectConversation" ADD COLUMN IF NOT EXISTS "locked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DirectConversation" ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3);
