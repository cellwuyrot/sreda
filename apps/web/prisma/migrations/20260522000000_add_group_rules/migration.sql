-- AlterTable
ALTER TABLE "Group" ADD COLUMN "rules" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "GroupMember" ADD COLUMN "rulesAccepted" BOOLEAN NOT NULL DEFAULT false;
