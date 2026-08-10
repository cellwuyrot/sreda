-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "statusType" VARCHAR(20) DEFAULT 'online';

-- AlterTable
ALTER TABLE "DirectConversation" ADD COLUMN IF NOT EXISTS "user1ReadAt" TIMESTAMP(3);
ALTER TABLE "DirectConversation" ADD COLUMN IF NOT EXISTS "user2ReadAt" TIMESTAMP(3);
