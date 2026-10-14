-- AlterTable
ALTER TABLE "User" ADD COLUMN     "contactAddress" VARCHAR(500);

-- CreateTable
CREATE TABLE "TzIdProjectSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "externalId" VARCHAR(100) NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TzIdProjectSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TzIdProjectNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "externalId" VARCHAR(100) NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "url" VARCHAR(2048),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TzIdProjectNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TzIdNotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TzIdNotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TzIdQrLogin" (
    "id" TEXT NOT NULL,
    "approvalHash" TEXT NOT NULL,
    "browserHash" TEXT NOT NULL,
    "interactionUid" TEXT NOT NULL,
    "clientId" TEXT,
    "verificationCode" VARCHAR(6) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedUserId" TEXT,
    "approvedSessionId" TEXT,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TzIdQrLogin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TzIdProjectSubscription_userId_updatedAt_idx" ON "TzIdProjectSubscription"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TzIdProjectSubscription_clientId_userId_externalId_key" ON "TzIdProjectSubscription"("clientId", "userId", "externalId");

-- CreateIndex
CREATE INDEX "TzIdProjectNotification_userId_clientId_createdAt_idx" ON "TzIdProjectNotification"("userId", "clientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TzIdProjectNotification_clientId_userId_externalId_key" ON "TzIdProjectNotification"("clientId", "userId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "TzIdNotificationPreference_userId_clientId_key" ON "TzIdNotificationPreference"("userId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "TzIdQrLogin_approvalHash_key" ON "TzIdQrLogin"("approvalHash");

-- CreateIndex
CREATE INDEX "TzIdQrLogin_interactionUid_expiresAt_idx" ON "TzIdQrLogin"("interactionUid", "expiresAt");

-- CreateIndex
CREATE INDEX "TzIdQrLogin_expiresAt_idx" ON "TzIdQrLogin"("expiresAt");

-- AddForeignKey
ALTER TABLE "TzIdProjectSubscription" ADD CONSTRAINT "TzIdProjectSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TzIdProjectSubscription" ADD CONSTRAINT "TzIdProjectSubscription_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "TzIdClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TzIdProjectNotification" ADD CONSTRAINT "TzIdProjectNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TzIdProjectNotification" ADD CONSTRAINT "TzIdProjectNotification_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "TzIdClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TzIdNotificationPreference" ADD CONSTRAINT "TzIdNotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TzIdNotificationPreference" ADD CONSTRAINT "TzIdNotificationPreference_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "TzIdClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

