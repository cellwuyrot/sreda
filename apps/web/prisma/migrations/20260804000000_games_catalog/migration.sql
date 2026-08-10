-- GAMES-CATALOG: каталог раздела /games.
--
-- IF NOT EXISTS и DO-блоки здесь не для красоты: часть таблиц этого проекта
-- исторически появилась через `prisma db push`, поэтому миграция должна
-- переживать базу, в которой объект уже есть.

CREATE TABLE IF NOT EXISTS "GameEntry" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "cover" TEXT,
    "players" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'OWN',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "launchUrl" TEXT NOT NULL DEFAULT '',
    "apiBaseUrl" TEXT NOT NULL DEFAULT '',
    "apiKey" TEXT,
    "linkState" TEXT NOT NULL DEFAULT 'PENDING',
    "linkError" VARCHAR(500) NOT NULL DEFAULT '',
    "partnerName" TEXT NOT NULL DEFAULT '',
    "onlinePlayers" INTEGER,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GameEntry_slug_key" ON "GameEntry"("slug");
CREATE INDEX IF NOT EXISTS "GameEntry_active_sortOrder_idx" ON "GameEntry"("active", "sortOrder");
CREATE INDEX IF NOT EXISTS "GameEntry_kind_idx" ON "GameEntry"("kind");

-- Вельд'Эран уже существует как страница и как GameRoom.gameType = 'velderan'.
-- Переносим его в каталог сразу активным, иначе после деплоя раздел /games
-- окажется пустым, хотя игра работает.
INSERT INTO "GameEntry" (
    "id", "slug", "title", "description", "cover", "players", "tags",
    "kind", "active", "sortOrder", "launchUrl", "createdAt", "updatedAt"
) VALUES (
    'game_velderan',
    'velderan',
    'Перо Измерений: Вельд''Эран',
    'Стратегическая настольная игра в мире тёмного фэнтези. Управляйте фракциями, ведите армии, призывайте богов и завоёвывайте континенты.',
    '/games/velderan/map.png',
    '2-10 игроков',
    'Стратегия, PvP, Настольная, Фэнтези',
    'OWN',
    true,
    0,
    '/games/velderan',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
) ON CONFLICT ("slug") DO NOTHING;
