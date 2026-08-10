-- SERVER-MESH: реестр серверов проекта (главный + дочерние узлы).
--
-- Токен агента хранится только как SHA-256: в открытом виде он показывается
-- администратору один раз при создании или перевыпуске и больше нигде не
-- всплывает — ни в списках, ни в логах.

CREATE TABLE IF NOT EXISTS "ServerNode" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CHILD',
    "kind" TEXT NOT NULL DEFAULT 'APP',
    "url" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    "tokenHash" TEXT,
    "lastReport" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "note" VARCHAR(300) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServerNode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ServerNode_name_key" ON "ServerNode" ("name");
CREATE INDEX IF NOT EXISTS "ServerNode_role_idx" ON "ServerNode" ("role");
CREATE INDEX IF NOT EXISTS "ServerNode_kind_idx" ON "ServerNode" ("kind");
