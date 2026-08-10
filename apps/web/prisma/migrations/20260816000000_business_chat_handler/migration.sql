-- Деловой чат: чат на каждое обращение и связка с тем, кто его ведёт.
--
-- ── Что здесь исправляется ──────────────────────────────────────────────────
--
-- Предыдущая миграция оставила уникальность по [user1Id, user2Id, kind]. Для
-- деловых разговоров это ошибка: второе обращение того же клиента к тому же
-- администратору упиралось в этот ключ, вставка падала, и клиент оставался без
-- чата — молча, потому что ошибку глотал вызывающий код. Одно обращение — один
-- чат, и это уже гарантирует уникальный "appealId".
--
-- Для личной переписки уникальность пары нужна по-прежнему (два диалога между
-- теми же людьми — это дубль), поэтому она остаётся, но становится частичной:
-- WHERE "kind" = 'PERSONAL'. Prisma частичные индексы в схеме описывать не
-- умеет — в schema.prisma на этом месте обычный @@index, и расхождение
-- намеренное. Если однажды понадобится `prisma migrate dev`, он предложит
-- пересоздать индекс: соглашаться нельзя, иначе вернётся исходная ошибка.
--
-- "handlerId" — кто из администрации ведёт разговор. Доступ к деловому чату
-- даёт роль (очередь видят все администраторы и редакторы), а отвечает один
-- человек, и остальные должны видеть, кто именно.
--
-- "notifyEmail" — письма по обращениям. По умолчанию включено: письмо приходит
-- либо по обращению, которое человек сам начал, либо по поручённой ему работе.
--
-- Всё идемпотентно: повторный запуск безопасен.

ALTER TABLE "DirectConversation" ADD COLUMN IF NOT EXISTS "handlerId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DirectConversation_handlerId_fkey'
  ) THEN
    ALTER TABLE "DirectConversation"
      ADD CONSTRAINT "DirectConversation_handlerId_fkey"
      FOREIGN KEY ("handlerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Парную уникальность снимаем и возвращаем частичной — только для личной переписки.
DROP INDEX IF EXISTS "DirectConversation_user1Id_user2Id_kind_key";
CREATE UNIQUE INDEX IF NOT EXISTS "DirectConversation_personal_pair_key"
  ON "DirectConversation"("user1Id", "user2Id")
  WHERE "kind" = 'PERSONAL';

CREATE INDEX IF NOT EXISTS "DirectConversation_user1Id_user2Id_kind_idx"
  ON "DirectConversation"("user1Id", "user2Id", "kind");
CREATE INDEX IF NOT EXISTS "DirectConversation_kind_lastMessageAt_idx"
  ON "DirectConversation"("kind", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "DirectConversation_handlerId_idx"
  ON "DirectConversation"("handlerId");

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "notifyEmail" BOOLEAN NOT NULL DEFAULT true;
