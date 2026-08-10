-- BUSINESS-PAY: счета по деловым разговорам, документы услуг и подписанные договоры.
--
-- Миграция только добавляет: ни одна существующая колонка не меняется и не удаляется,
-- поэтому она безопасна для уже работающей базы и не требует простоя.

-- Документы услуги: [{ id, name, url, size, mime, uploadedAt }, …].
ALTER TABLE "Service" ADD COLUMN "documents" JSONB;

CREATE TABLE "BusinessPayment" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "serviceId" TEXT,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'RUB',
    "requisites" TEXT,
    "documents" JSONB,
    "status" VARCHAR(16) NOT NULL DEFAULT 'UNPAID',
    "signedAt" TIMESTAMP(3),
    "signedName" VARCHAR(200),
    "declaredAt" TIMESTAMP(3),
    "declaredNote" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessPayment_pkey" PRIMARY KEY ("id")
);

-- Один разговор — один счёт. Гонка двух администраторов, выставляющих счёт
-- одновременно, должна заканчиваться ошибкой вставки, а не двумя счетами.
CREATE UNIQUE INDEX "BusinessPayment_conversationId_key" ON "BusinessPayment"("conversationId");
CREATE INDEX "BusinessPayment_status_createdAt_idx" ON "BusinessPayment"("status", "createdAt");
CREATE INDEX "BusinessPayment_serviceId_idx" ON "BusinessPayment"("serviceId");

CREATE TABLE "BusinessContract" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "url" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "mime" VARCHAR(128),
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessContract_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BusinessContract_paymentId_createdAt_idx" ON "BusinessContract"("paymentId", "createdAt");

-- Счёт умирает вместе с разговором (Cascade), но НЕ вместе с услугой и НЕ вместе
-- с учётной записью выставившего его сотрудника (SetNull): уволившийся
-- администратор не должен уносить с собой финансовый документ.
ALTER TABLE "BusinessPayment" ADD CONSTRAINT "BusinessPayment_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "DirectConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessPayment" ADD CONSTRAINT "BusinessPayment_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BusinessPayment" ADD CONSTRAINT "BusinessPayment_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BusinessContract" ADD CONSTRAINT "BusinessContract_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "BusinessPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessContract" ADD CONSTRAINT "BusinessContract_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
