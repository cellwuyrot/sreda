-- VPN-PLAN: подписка «только VPN».

-- Право на туннель без остальных возможностей Premium.
ALTER TABLE "User" ADD COLUMN "vpnAccess" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "vpnAccessUntil" TIMESTAMP(3);

CREATE TABLE "VpnSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'month',
    "paymentMethod" TEXT NOT NULL DEFAULT 'manual',
    "amount" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "reference" VARCHAR(200),
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VpnSubscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VpnSubscription_userId_idx" ON "VpnSubscription"("userId");
CREATE INDEX "VpnSubscription_status_idx" ON "VpnSubscription"("status");

ALTER TABLE "VpnSubscription" ADD CONSTRAINT "VpnSubscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VpnSubscription" ADD CONSTRAINT "VpnSubscription_grantedById_fkey"
    FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
