-- AlterTable
ALTER TABLE "GroupMember" ADD COLUMN "muted" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ChannelMute" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "muted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ChannelMute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMute_userId_channelId_key" ON "ChannelMute"("userId", "channelId");
CREATE INDEX "ChannelMute_userId_idx" ON "ChannelMute"("userId");

-- AddForeignKey
ALTER TABLE "ChannelMute" ADD CONSTRAINT "ChannelMute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelMute" ADD CONSTRAINT "ChannelMute_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
