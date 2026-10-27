-- Additive migration. Deploy before enabling the updated web/server code.
ALTER TABLE "DirectConversation" ADD COLUMN "user1ReceiptAt" TIMESTAMP(3), ADD COLUMN "user2ReceiptAt" TIMESTAMP(3);
-- Deliberately do not backfill receipts from private read timestamps.
ALTER TABLE "DirectMessage" ADD COLUMN "replyQuote" TEXT, ADD COLUMN "clientMessageId" VARCHAR(80);
CREATE UNIQUE INDEX "DirectMessage_conversationId_userId_clientMessageId_key" ON "DirectMessage"("conversationId", "userId", "clientMessageId");
CREATE INDEX "DirectMessage_conversationId_createdAt_id_idx" ON "DirectMessage"("conversationId", "createdAt", "id");
CREATE TABLE "DirectMessageReaction" (
  "id" TEXT NOT NULL, "messageId" TEXT NOT NULL, "userId" TEXT NOT NULL, "emoji" VARCHAR(64) NOT NULL,
  CONSTRAINT "DirectMessageReaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DirectMessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "DirectMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DirectMessageReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DirectMessageReaction_messageId_userId_emoji_key" ON "DirectMessageReaction"("messageId", "userId", "emoji");
