-- Таблицы банов группы (GroupBan) и журнала аудита группы (GroupAuditEntry)
-- были описаны в schema.prisma, но не имели миграции: на базах, обновляемых
-- через `prisma migrate deploy`, их не было — выдача бана падала с ошибкой,
-- а список забаненных не загружался. IF NOT EXISTS делает миграцию
-- безопасной для баз, где таблицы уже созданы через `prisma db push`.

CREATE TABLE IF NOT EXISTS "GroupBan" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" VARCHAR(300),
    "bannedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupBan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GroupBan_groupId_userId_key" ON "GroupBan"("groupId", "userId");
CREATE INDEX IF NOT EXISTS "GroupBan_userId_idx" ON "GroupBan"("userId");
DO $$ BEGIN
    ALTER TABLE "GroupBan" ADD CONSTRAINT "GroupBan_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "GroupBan" ADD CONSTRAINT "GroupBan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "GroupBan" ADD CONSTRAINT "GroupBan_bannedById_fkey" FOREIGN KEY ("bannedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "GroupAuditEntry" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "targetName" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupAuditEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "GroupAuditEntry_groupId_createdAt_idx" ON "GroupAuditEntry"("groupId", "createdAt");
DO $$ BEGIN
    ALTER TABLE "GroupAuditEntry" ADD CONSTRAINT "GroupAuditEntry_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- НОВОЕ: известные идентификаторы пользователя (IP, ID устройства на основе MAC)
-- и их блокировка при глобальном бане (остановка учётной записи по IP и MAC).
CREATE TABLE IF NOT EXISTS "UserIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserIdentity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserIdentity_userId_kind_value_key" ON "UserIdentity"("userId", "kind", "value");
CREATE INDEX IF NOT EXISTS "UserIdentity_kind_value_idx" ON "UserIdentity"("kind", "value");
DO $$ BEGIN
    ALTER TABLE "UserIdentity" ADD CONSTRAINT "UserIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "BlockedIdentity" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "userId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BlockedIdentity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BlockedIdentity_kind_value_key" ON "BlockedIdentity"("kind", "value");
CREATE INDEX IF NOT EXISTS "BlockedIdentity_userId_idx" ON "BlockedIdentity"("userId");
