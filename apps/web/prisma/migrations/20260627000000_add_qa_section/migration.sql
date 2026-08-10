-- Q&A section: threads, answers, votes
CREATE TABLE "QAThread" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "tags" TEXT NOT NULL DEFAULT '',
    "acceptedAnswerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QAThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QAAnswer" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QAAnswer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QAVote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT,
    "answerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QAVote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QAThread_channelId_idx" ON "QAThread"("channelId");
CREATE INDEX "QAThread_authorId_idx" ON "QAThread"("authorId");
CREATE INDEX "QAAnswer_threadId_idx" ON "QAAnswer"("threadId");
CREATE INDEX "QAAnswer_authorId_idx" ON "QAAnswer"("authorId");
CREATE INDEX "QAVote_threadId_idx" ON "QAVote"("threadId");
CREATE INDEX "QAVote_answerId_idx" ON "QAVote"("answerId");
CREATE UNIQUE INDEX "QAVote_userId_threadId_key" ON "QAVote"("userId", "threadId");
CREATE UNIQUE INDEX "QAVote_userId_answerId_key" ON "QAVote"("userId", "answerId");

ALTER TABLE "QAThread" ADD CONSTRAINT "QAThread_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QAThread" ADD CONSTRAINT "QAThread_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QAAnswer" ADD CONSTRAINT "QAAnswer_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "QAThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QAAnswer" ADD CONSTRAINT "QAAnswer_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QAVote" ADD CONSTRAINT "QAVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QAVote" ADD CONSTRAINT "QAVote_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "QAThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QAVote" ADD CONSTRAINT "QAVote_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "QAAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
