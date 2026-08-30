-- DM-FOLDER-SYNC: папки личных сообщений теперь хранятся на сервере.
-- Раньше раскладка жила в localStorage — синхронизации между браузером,
-- десктопом и телефоном не было. Таблица хранит одну JSON-запись на
-- пользователя × раздел (dm, business и т. д.).
CREATE TABLE IF NOT EXISTS "DmFolderLayout" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "kind"      TEXT NOT NULL,
    "data"      TEXT NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DmFolderLayout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DmFolderLayout_userId_kind_key"
    ON "DmFolderLayout"("userId", "kind");

ALTER TABLE "DmFolderLayout"
    ADD CONSTRAINT "DmFolderLayout_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
