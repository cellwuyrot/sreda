-- PAYLINK: пул одноразовых платёжных ссылок (1 ссылка = 1 подписка).
CREATE TABLE IF NOT EXISTS "PaymentLink" (
    "id" TEXT NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "plan" VARCHAR(16) NOT NULL DEFAULT 'month',
    "amount" INTEGER NOT NULL DEFAULT 0,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'RUB',
    "url" VARCHAR(500) NOT NULL,
    "label" VARCHAR(200),
    "status" VARCHAR(16) NOT NULL DEFAULT 'FREE',
    "reservedById" TEXT,
    "reservedAt" TIMESTAMP(3),
    "reservationExpiresAt" TIMESTAMP(3),
    "paidReportedAt" TIMESTAMP(3),
    "payerReference" VARCHAR(200),
    "usedById" TEXT,
    "usedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "subscriptionId" VARCHAR(64),
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentLink_url_key" ON "PaymentLink"("url");
CREATE INDEX IF NOT EXISTS "PaymentLink_kind_status_idx" ON "PaymentLink"("kind", "status");
CREATE INDEX IF NOT EXISTS "PaymentLink_reservedById_idx" ON "PaymentLink"("reservedById");
CREATE INDEX IF NOT EXISTS "PaymentLink_usedById_idx" ON "PaymentLink"("usedById");

DO $$ BEGIN
    ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_reservedById_fkey"
        FOREIGN KEY ("reservedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_usedById_fkey"
        FOREIGN KEY ("usedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_confirmedById_fkey"
        FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
