CREATE TABLE "TaskComment" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "mentions" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskComment_taskId_createdAt_idx" ON "TaskComment"("taskId", "createdAt");
CREATE INDEX "TaskComment_authorId_idx" ON "TaskComment"("authorId");

ALTER TABLE "TaskComment"
ADD CONSTRAINT "TaskComment_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "ChannelTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskComment"
ADD CONSTRAINT "TaskComment_authorId_fkey"
FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
