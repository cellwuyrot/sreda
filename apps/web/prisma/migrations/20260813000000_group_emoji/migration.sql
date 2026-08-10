-- Свои эмодзи сообщества.
--
-- Набор принадлежит сообществу: перенести эмодзи в другое нельзя, поэтому
-- groupId входит в уникальный ключ вместе с именем, а внешний ключ с каскадом
-- убирает набор вместе с сообществом (файлы чистит задача очистки загрузок).

CREATE TABLE IF NOT EXISTS "GroupEmoji" (
    "id"          TEXT NOT NULL,
    "groupId"     TEXT NOT NULL,
    "name"        VARCHAR(32) NOT NULL,
    "url"         TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupEmoji_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GroupEmoji_groupId_name_key" ON "GroupEmoji"("groupId", "name");
CREATE INDEX IF NOT EXISTS "GroupEmoji_groupId_idx" ON "GroupEmoji"("groupId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GroupEmoji_groupId_fkey'
  ) THEN
    ALTER TABLE "GroupEmoji"
      ADD CONSTRAINT "GroupEmoji_groupId_fkey"
      FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
