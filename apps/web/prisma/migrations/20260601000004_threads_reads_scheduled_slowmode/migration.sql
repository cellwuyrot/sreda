-- AlterTable: add thread fields to Message
ALTER TABLE "Message" ADD COLUMN "threadId" TEXT;
ALTER TABLE "Message" ADD COLUMN "threadCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: add slowmode to Channel
ALTER TABLE "Channel" ADD COLUMN "slowmode" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Message_threadId_idx" ON "Message"("threadId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: MessageRead
CREATE TABLE "MessageRead" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageRead_userId_messageId_key" ON "MessageRead"("userId", "messageId");
CREATE INDEX "MessageRead_messageId_idx" ON "MessageRead"("messageId");

ALTER TABLE "MessageRead" ADD CONSTRAINT "MessageRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageRead" ADD CONSTRAINT "MessageRead_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: ScheduledMessage
CREATE TABLE "ScheduledMessage" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScheduledMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScheduledMessage_scheduledAt_sent_idx" ON "ScheduledMessage"("scheduledAt", "sent");
CREATE INDEX "ScheduledMessage_userId_idx" ON "ScheduledMessage"("userId");

ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
