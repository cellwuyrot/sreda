-- Ручная миграция (эквивалент schema-additions.prisma).
-- Предпочтительный путь: внести правки в schema.prisma и выполнить
--   npx prisma migrate dev --name community_settings_update
-- Этот SQL — запасной вариант для применения напрямую (psql) с последующим
--   npx prisma generate

ALTER TABLE "Group" ADD COLUMN "banner" TEXT;
ALTER TABLE "Group" ADD COLUMN "requireRules" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "GroupMember" ADD COLUMN "mutedUntil" TIMESTAMP(3);
ALTER TABLE "GroupMember" ADD COLUMN "muteReason" VARCHAR(300);

CREATE TABLE "GroupAuditEntry" (
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

CREATE INDEX "GroupAuditEntry_groupId_createdAt_idx" ON "GroupAuditEntry"("groupId", "createdAt");

ALTER TABLE "GroupAuditEntry"
  ADD CONSTRAINT "GroupAuditEntry_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
