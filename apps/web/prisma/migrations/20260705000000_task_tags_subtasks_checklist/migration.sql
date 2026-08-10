-- Add tags (comma-separated labels) and subtask self-relation to ChannelTask
ALTER TABLE "ChannelTask" ADD COLUMN "tags" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ChannelTask" ADD COLUMN "parentId" TEXT;

CREATE INDEX "ChannelTask_parentId_idx" ON "ChannelTask"("parentId");

ALTER TABLE "ChannelTask"
ADD CONSTRAINT "ChannelTask_parentId_fkey"
FOREIGN KEY ("parentId") REFERENCES "ChannelTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Checklist items inside a task card
CREATE TABLE "TaskChecklistItem" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskChecklistItem_taskId_idx" ON "TaskChecklistItem"("taskId");

ALTER TABLE "TaskChecklistItem"
ADD CONSTRAINT "TaskChecklistItem_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "ChannelTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
