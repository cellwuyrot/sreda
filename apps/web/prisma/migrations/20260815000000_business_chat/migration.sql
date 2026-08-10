-- Деловой чат по обращению: вид разговора и связь с обращением.
--
-- Ключ уникальности раньше был по паре пользователей, поэтому деловой разговор
-- между клиентом и администратором нельзя было создать, если у них уже есть
-- личная переписка. Вид разговора входит в ключ — теперь это два разных
-- разговора, как и должно быть.
--
-- Всё идемпотентно: повторный запуск безопасен.

ALTER TABLE "DirectConversation" ADD COLUMN IF NOT EXISTS "kind" VARCHAR(16) NOT NULL DEFAULT 'PERSONAL';
ALTER TABLE "DirectConversation" ADD COLUMN IF NOT EXISTS "appealId" TEXT;

DROP INDEX IF EXISTS "DirectConversation_user1Id_user2Id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "DirectConversation_user1Id_user2Id_kind_key"
  ON "DirectConversation"("user1Id", "user2Id", "kind");
CREATE UNIQUE INDEX IF NOT EXISTS "DirectConversation_appealId_key"
  ON "DirectConversation"("appealId");
