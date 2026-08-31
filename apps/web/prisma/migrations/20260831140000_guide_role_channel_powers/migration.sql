-- Migration: GUIDE role (time-limited intermediate) + ChannelRolePower (role-to-channel full moderation)

-- GUIDE role: store expiry date on the member record
ALTER TABLE "GroupMember" ADD COLUMN IF NOT EXISTS "guidedUntil" TIMESTAMPTZ;

-- ChannelRolePower: bind a custom tag-role to a specific channel for full moderation
CREATE TABLE IF NOT EXISTS "ChannelRolePower" (
    "id"        TEXT        NOT NULL,
    "roleId"    TEXT        NOT NULL,
    "channelId" TEXT        NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "ChannelRolePower_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ChannelRolePower_roleId_fkey"
        FOREIGN KEY ("roleId") REFERENCES "GroupRole"("id") ON DELETE CASCADE,
    CONSTRAINT "ChannelRolePower_channelId_fkey"
        FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ChannelRolePower_roleId_channelId_key"
    ON "ChannelRolePower"("roleId", "channelId");
CREATE INDEX IF NOT EXISTS "ChannelRolePower_channelId_idx"
    ON "ChannelRolePower"("channelId");
