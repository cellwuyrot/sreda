-- CreateTable
CREATE TABLE "WorkspaceFile" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspaceFile_channelId_idx" ON "WorkspaceFile"("channelId");

-- AddForeignKey
ALTER TABLE "WorkspaceFile" ADD CONSTRAINT "WorkspaceFile_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceFile" ADD CONSTRAINT "WorkspaceFile_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
