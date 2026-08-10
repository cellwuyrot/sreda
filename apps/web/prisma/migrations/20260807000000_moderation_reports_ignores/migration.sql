-- MODERATION: жалобы участников и персональный игнор на стороне сервера.

CREATE TABLE IF NOT EXISTS "GroupReport" (
    "id"          TEXT NOT NULL,
    "groupId"     TEXT NOT NULL,
    "reporterId"  TEXT NOT NULL,
    "targetId"    TEXT NOT NULL,
    "messageId"   TEXT,
    "channelId"   TEXT,
    "excerpt"     VARCHAR(300),
    "reason"      VARCHAR(300) NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'OPEN',
    "handledById" TEXT,
    "handledAt"   TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GroupReport_groupId_reporterId_messageId_key"
    ON "GroupReport"("groupId", "reporterId", "messageId");
CREATE INDEX IF NOT EXISTS "GroupReport_groupId_status_createdAt_idx"
    ON "GroupReport"("groupId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "GroupReport_targetId_idx" ON "GroupReport"("targetId");

CREATE TABLE IF NOT EXISTS "UserIgnore" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "ignoredId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserIgnore_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserIgnore_userId_ignoredId_key" ON "UserIgnore"("userId", "ignoredId");
CREATE INDEX IF NOT EXISTS "UserIgnore_ignoredId_idx" ON "UserIgnore"("ignoredId");

-- Внешние ключи. messageId сознательно без ссылки на Message: жалоба должна
-- пережить удаление сообщения, ради которого её и написали.
DO $$
BEGIN
    ALTER TABLE "GroupReport" ADD CONSTRAINT "GroupReport_groupId_fkey"
        FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "GroupReport" ADD CONSTRAINT "GroupReport_reporterId_fkey"
        FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "GroupReport" ADD CONSTRAINT "GroupReport_targetId_fkey"
        FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "GroupReport" ADD CONSTRAINT "GroupReport_handledById_fkey"
        FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "UserIgnore" ADD CONSTRAINT "UserIgnore_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "UserIgnore" ADD CONSTRAINT "UserIgnore_ignoredId_fkey"
        FOREIGN KEY ("ignoredId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
