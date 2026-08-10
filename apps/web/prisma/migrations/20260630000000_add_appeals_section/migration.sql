-- CreateTable
CREATE TABLE "Appeal" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Appeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppealMessage" (
    "id" TEXT NOT NULL,
    "appealId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppealMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Appeal_channelId_idx" ON "Appeal"("channelId");
CREATE INDEX "Appeal_authorId_idx" ON "Appeal"("authorId");
CREATE INDEX "Appeal_status_idx" ON "Appeal"("status");
CREATE INDEX "AppealMessage_appealId_idx" ON "AppealMessage"("appealId");
CREATE INDEX "AppealMessage_authorId_idx" ON "AppealMessage"("authorId");

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppealMessage" ADD CONSTRAINT "AppealMessage_appealId_fkey" FOREIGN KEY ("appealId") REFERENCES "Appeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppealMessage" ADD CONSTRAINT "AppealMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
