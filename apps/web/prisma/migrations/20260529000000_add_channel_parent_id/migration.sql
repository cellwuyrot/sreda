-- AlterTable
ALTER TABLE "Channel" ADD COLUMN "parentId" TEXT;

-- CreateIndex
CREATE INDEX "Channel_parentId_idx" ON "Channel"("parentId");
