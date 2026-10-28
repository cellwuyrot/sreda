-- CreateTable
CREATE TABLE "TzManagedService" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "accessKind" TEXT NOT NULL DEFAULT 'MANUAL',
    "prices" TEXT NOT NULL DEFAULT '{}',
    "methods" TEXT NOT NULL DEFAULT '["ONE_TIME"]',
    "allowCancel" BOOLEAN NOT NULL DEFAULT true,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TzManagedService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TzManagedConnection" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "accessKind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidUntil" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL,
    "manualState" TEXT NOT NULL DEFAULT 'NONE',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TzManagedConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TzServiceAudit" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TzServiceAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TzBridgeNonce" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TzBridgeNonce_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TzManagedService_clientId_published_idx" ON "TzManagedService"("clientId", "published");

-- CreateIndex
CREATE INDEX "TzManagedConnection_userId_paidUntil_idx" ON "TzManagedConnection"("userId", "paidUntil");

-- CreateIndex
CREATE UNIQUE INDEX "TzManagedConnection_clientId_externalId_key" ON "TzManagedConnection"("clientId", "externalId");

-- CreateIndex
CREATE INDEX "TzServiceAudit_clientId_createdAt_idx" ON "TzServiceAudit"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "TzBridgeNonce_expiresAt_idx" ON "TzBridgeNonce"("expiresAt");

