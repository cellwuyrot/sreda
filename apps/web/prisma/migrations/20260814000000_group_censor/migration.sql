-- Словарь цензуры сообщества и счётчик замеченных упоминаний.
--
-- Две таблицы, а не одна: словарь администратор правит, а наблюдения только
-- накапливаются. Слово в наблюдении хранится снимком, поэтому удаление записи
-- из словаря не стирает историю — иначе счётчик у человека падал бы вместе с
-- правкой словаря, и объяснить его было бы нечем.
--
-- Всё с IF NOT EXISTS: повторный запуск безопасен.

CREATE TABLE IF NOT EXISTS "GroupCensorWord" (
    "id"          TEXT NOT NULL,
    "groupId"     TEXT NOT NULL,
    "word"        VARCHAR(64) NOT NULL,
    "level"       VARCHAR(8) NOT NULL DEFAULT 'WATCH',
    "createdById" TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupCensorWord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GroupCensorWord_groupId_word_key" ON "GroupCensorWord"("groupId", "word");
CREATE INDEX IF NOT EXISTS "GroupCensorWord_groupId_idx" ON "GroupCensorWord"("groupId");

CREATE TABLE IF NOT EXISTS "CensorHit" (
    "id"        TEXT NOT NULL,
    "groupId"   TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "word"      VARCHAR(64) NOT NULL,
    "level"     VARCHAR(8) NOT NULL,
    "channelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CensorHit_pkey" PRIMARY KEY ("id")
);

-- Первый индекс — под сводку «сколько у кого», второй — под ленту последних
-- срабатываний в разделе цензуры.
CREATE INDEX IF NOT EXISTS "CensorHit_groupId_userId_idx" ON "CensorHit"("groupId", "userId");
CREATE INDEX IF NOT EXISTS "CensorHit_groupId_createdAt_idx" ON "CensorHit"("groupId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GroupCensorWord_groupId_fkey') THEN
    ALTER TABLE "GroupCensorWord"
      ADD CONSTRAINT "GroupCensorWord_groupId_fkey"
      FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CensorHit_groupId_fkey') THEN
    ALTER TABLE "CensorHit"
      ADD CONSTRAINT "CensorHit_groupId_fkey"
      FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
