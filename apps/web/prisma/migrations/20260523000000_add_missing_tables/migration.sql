-- AlterTable: Add missing columns to User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bio" VARCHAR(200);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "socialLinks" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "customStatus" VARCHAR(100);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "statusEmoji" VARCHAR(10);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "privacyOnline" TEXT NOT NULL DEFAULT 'everyone';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "privacyFriends" TEXT NOT NULL DEFAULT 'everyone';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "privacyEmail" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "notifySound" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "notifyPush" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mutedGroups" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mutedChannels" TEXT;

-- AlterTable: Add missing columns to Message
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "pinnedBy" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "pinnedAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "replyToId" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "mentions" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Reaction" (
    "id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DirectConversation" (
    "id" TEXT NOT NULL,
    "user1Id" TEXT NOT NULL,
    "user2Id" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DirectMessage" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" TIMESTAMP(3),
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "attachments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Badge" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT,
    "imageUrl" TEXT,
    "rarity" TEXT NOT NULL DEFAULT 'common',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "UserBadge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "awardedBy" TEXT,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBadge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "token" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastUsed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Reaction_userId_messageId_emoji_key" ON "Reaction"("userId", "messageId", "emoji");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Reaction_messageId_idx" ON "Reaction"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DirectConversation_user1Id_user2Id_key" ON "DirectConversation"("user1Id", "user2Id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DirectConversation_user1Id_idx" ON "DirectConversation"("user1Id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DirectConversation_user2Id_idx" ON "DirectConversation"("user2Id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DirectMessage_conversationId_createdAt_idx" ON "DirectMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "UserBadge_userId_badgeId_key" ON "UserBadge"("userId", "badgeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserBadge_userId_idx" ON "UserBadge"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "UserSession_token_key" ON "UserSession"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserSession_userId_idx" ON "UserSession"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserSession_token_idx" ON "UserSession"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Message_replyToId_idx" ON "Message"("replyToId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectConversation" ADD CONSTRAINT "DirectConversation_user1Id_fkey" FOREIGN KEY ("user1Id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectConversation" ADD CONSTRAINT "DirectConversation_user2Id_fkey" FOREIGN KEY ("user2Id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "DirectConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
