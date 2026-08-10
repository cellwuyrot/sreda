-- PREMIUM-PAY: подписки Premium, привязанные к платежам (СБП / эквайринг).
-- Создаётся администратором при связи с профилем клиента. Платёжные реквизиты
-- (СБП и интернет-эквайринг) хранятся в таблице SiteConfig как key/value и
-- отдельной миграции схемы не требуют.

CREATE TABLE "PremiumSubscription" (
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
    CONSTRAINT "PremiumSubscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PremiumSubscription_userId_idx" ON "PremiumSubscription"("userId");
CREATE INDEX "PremiumSubscription_status_idx" ON "PremiumSubscription"("status");

ALTER TABLE "PremiumSubscription"
  ADD CONSTRAINT "PremiumSubscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PremiumSubscription"
  ADD CONSTRAINT "PremiumSubscription_grantedById_fkey"
  FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
