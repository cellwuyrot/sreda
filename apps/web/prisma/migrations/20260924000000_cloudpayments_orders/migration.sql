-- CLOUDPAYMENTS: server-side payment orders for Premium/VPN subscriptions.
CREATE TABLE IF NOT EXISTS "CloudPaymentOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "plan" VARCHAR(16) NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "invoiceId" VARCHAR(80) NOT NULL,
    "cloudOrderId" VARCHAR(160),
    "cloudTransactionId" VARCHAR(64),
    "cloudSubscriptionId" VARCHAR(160),
    "paymentUrl" VARCHAR(1000),
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "localSubscriptionId" VARCHAR(80),
    "paidAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CloudPaymentOrder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CloudPaymentOrder_invoiceId_key" UNIQUE ("invoiceId")
);

CREATE INDEX IF NOT EXISTS "CloudPaymentOrder_userId_status_idx" ON "CloudPaymentOrder"("userId", "status");
CREATE INDEX IF NOT EXISTS "CloudPaymentOrder_kind_status_idx" ON "CloudPaymentOrder"("kind", "status");
CREATE INDEX IF NOT EXISTS "CloudPaymentOrder_cloudSubscriptionId_idx" ON "CloudPaymentOrder"("cloudSubscriptionId");
CREATE INDEX IF NOT EXISTS "CloudPaymentOrder_cloudTransactionId_idx" ON "CloudPaymentOrder"("cloudTransactionId");

CREATE TABLE IF NOT EXISTS "CloudPaymentTransaction" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "transactionId" VARCHAR(64) NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CloudPaymentTransaction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CloudPaymentTransaction_transactionId_key" UNIQUE ("transactionId")
);

CREATE INDEX IF NOT EXISTS "CloudPaymentTransaction_orderId_createdAt_idx" ON "CloudPaymentTransaction"("orderId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "CloudPaymentOrder" ADD CONSTRAINT "CloudPaymentOrder_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CloudPaymentTransaction" ADD CONSTRAINT "CloudPaymentTransaction_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "CloudPaymentOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
