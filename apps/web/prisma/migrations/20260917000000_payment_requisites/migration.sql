-- PAY-TEMPLATE: шаблоны платёжных реквизитов.
-- Миграция аддитивная: существующие счета продолжают работать с текстом в
-- BusinessPayment.requisites, шаблон лишь указывает, откуда этот текст взяли.

CREATE TABLE "PaymentRequisite" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "scope" VARCHAR(16) NOT NULL DEFAULT 'BUSINESS',
    "ownerId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "orgName" VARCHAR(200) NOT NULL DEFAULT '',
    "inn" VARCHAR(20) NOT NULL DEFAULT '',
    "kpp" VARCHAR(20) NOT NULL DEFAULT '',
    "bank" VARCHAR(200) NOT NULL DEFAULT '',
    "bik" VARCHAR(20) NOT NULL DEFAULT '',
    "account" VARCHAR(34) NOT NULL DEFAULT '',
    "corrAccount" VARCHAR(34) NOT NULL DEFAULT '',
    "purpose" VARCHAR(300) NOT NULL DEFAULT '',
    "sbpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sbpPhone" VARCHAR(32) NOT NULL DEFAULT '',
    "sbpBank" VARCHAR(120) NOT NULL DEFAULT '',
    "sbpRecipient" VARCHAR(200) NOT NULL DEFAULT '',
    "acquiringEnabled" BOOLEAN NOT NULL DEFAULT false,
    "acquiringProvider" VARCHAR(120) NOT NULL DEFAULT '',
    "acquiringLink" VARCHAR(500) NOT NULL DEFAULT '',
    "acquiringMerchant" VARCHAR(120) NOT NULL DEFAULT '',
    "comment" TEXT,
    "bodyOverride" TEXT,
    "mode" VARCHAR(16) NOT NULL DEFAULT 'ONE_TIME',
    "period" VARCHAR(16),
    "createdById" TEXT,
    "createdByName" VARCHAR(120) NOT NULL DEFAULT '',
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRequisite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentRequisite_scope_ownerId_idx" ON "PaymentRequisite"("scope", "ownerId");
CREATE INDEX "PaymentRequisite_ownerId_isDefault_idx" ON "PaymentRequisite"("ownerId", "isDefault");

ALTER TABLE "PaymentRequisite" ADD CONSTRAINT "PaymentRequisite_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessPayment" ADD COLUMN "requisiteId" TEXT;

CREATE INDEX "BusinessPayment_requisiteId_idx" ON "BusinessPayment"("requisiteId");

ALTER TABLE "BusinessPayment" ADD CONSTRAINT "BusinessPayment_requisiteId_fkey"
    FOREIGN KEY ("requisiteId") REFERENCES "PaymentRequisite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
