-- AlterTable
ALTER TABLE "DirectMessage" ADD COLUMN "replyToId" TEXT;

-- CreateIndex
CREATE INDEX "DirectMessage_replyToId_idx" ON "DirectMessage"("replyToId");
