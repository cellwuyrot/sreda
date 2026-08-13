-- BUSINESS-CABINET: сроки, ответственный, счета, документы и история этапов.
-- Миграция только добавляет столбцы и таблицы: существующие данные не трогает.

ALTER TABLE "PartnerProject" ADD COLUMN "dueDate" TIMESTAMP(3);
ALTER TABLE "PartnerProject" ADD COLUMN "responsibleId" TEXT;

CREATE INDEX "PartnerProject_responsibleId_idx" ON "PartnerProject"("responsibleId");

ALTER TABLE "PartnerProject"
  ADD CONSTRAINT "PartnerProject_responsibleId_fkey"
  FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ProjectInvoice" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "number" INTEGER NOT NULL DEFAULT 1,
  "title" VARCHAR(200) NOT NULL,
  "amount" INTEGER NOT NULL DEFAULT 0,
  "currency" VARCHAR(8) NOT NULL DEFAULT 'RUB',
  "status" VARCHAR(16) NOT NULL DEFAULT 'UNPAID',
  "method" VARCHAR(32),
  "reference" VARCHAR(300),
  "note" TEXT,
  "dueDate" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdByName" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectInvoice_projectId_number_key" ON "ProjectInvoice"("projectId", "number");
CREATE INDEX "ProjectInvoice_projectId_status_idx" ON "ProjectInvoice"("projectId", "status");

ALTER TABLE "ProjectInvoice"
  ADD CONSTRAINT "ProjectInvoice_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "PartnerProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProjectDocument" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "kind" VARCHAR(16) NOT NULL DEFAULT 'CONTRACT',
  "name" VARCHAR(200) NOT NULL,
  "url" VARCHAR(500) NOT NULL,
  "size" INTEGER NOT NULL DEFAULT 0,
  "mime" VARCHAR(120),
  "uploadedById" TEXT,
  "uploadedByName" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectDocument_projectId_kind_idx" ON "ProjectDocument"("projectId", "kind");

ALTER TABLE "ProjectDocument"
  ADD CONSTRAINT "ProjectDocument_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "PartnerProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProjectEvent" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "kind" VARCHAR(24) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "details" TEXT,
  "actorId" TEXT,
  "actorName" TEXT NOT NULL DEFAULT '',
  "actorSide" VARCHAR(8) NOT NULL DEFAULT 'STAFF',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectEvent_projectId_createdAt_idx" ON "ProjectEvent"("projectId", "createdAt");

ALTER TABLE "ProjectEvent"
  ADD CONSTRAINT "ProjectEvent_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "PartnerProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
