CREATE TABLE "VpnAccountUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rxBytes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "txBytes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "usageResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usageUpdatedAt" TIMESTAMP(3),
    CONSTRAINT "VpnAccountUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VpnAccountUsage_userId_key"
ON "VpnAccountUsage"("userId");

ALTER TABLE "VpnAccountUsage"
ADD CONSTRAINT "VpnAccountUsage_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Переносим уже накопленный расход существующих VPN-пиров.
INSERT INTO "VpnAccountUsage"
    ("id", "userId", "rxBytes", "txBytes", "usageResetAt", "usageUpdatedAt")
SELECT
    'vpnusage_' || "userId",
    "userId",
    "rxBytes",
    "txBytes",
    "usageResetAt",
    "usageUpdatedAt"
FROM "VpnPeer";

DROP INDEX IF EXISTS "VpnPeer_userId_key";

CREATE INDEX IF NOT EXISTS "VpnPeer_userId_idx"
ON "VpnPeer"("userId");
