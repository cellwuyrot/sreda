-- Add priority to GroupRole for ordering and primary-color selection
ALTER TABLE "GroupRole" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
