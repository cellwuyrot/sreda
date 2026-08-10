-- CreateTable
CREATE TABLE "Poll" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "multiple" BOOLEAN NOT NULL DEFAULT false,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Poll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollOption" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "PollOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollVote" (
    "id" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "PollVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelTask" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Poll_channelId_idx" ON "Poll"("channelId");
CREATE INDEX "PollOption_pollId_idx" ON "PollOption"("pollId");
CREATE UNIQUE INDEX "PollVote_optionId_userId_key" ON "PollVote"("optionId", "userId");
CREATE INDEX "ChannelTask_channelId_idx" ON "ChannelTask"("channelId");
CREATE INDEX "ChannelTask_assigneeId_idx" ON "ChannelTask"("assigneeId");
CREATE INDEX "ChannelTask_status_idx" ON "ChannelTask"("status");

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PollOption" ADD CONSTRAINT "PollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "PollOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelTask" ADD CONSTRAINT "ChannelTask_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelTask" ADD CONSTRAINT "ChannelTask_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelTask" ADD CONSTRAINT "ChannelTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
