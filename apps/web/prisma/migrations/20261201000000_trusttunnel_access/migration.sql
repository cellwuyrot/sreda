-- TRUSTTUNNEL-SUBSCRIBERS: включение TrustTunnel для подписчиков.
-- Паролей в таблице нет: они выводятся из серверного ключа и generation.
-- Существующие таблицы и данные не меняются.

CREATE TABLE IF NOT EXISTS "TrustTunnelAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "disabledAt" TIMESTAMP(3),
    "lastIssuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrustTunnelAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TrustTunnelAccess_userId_key" ON "TrustTunnelAccess"("userId");
CREATE INDEX IF NOT EXISTS "TrustTunnelAccess_disabledAt_idx" ON "TrustTunnelAccess"("disabledAt");
