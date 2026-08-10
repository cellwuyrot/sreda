-- AlterTable: Add isMain to Group
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS "isMain" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Add isRestricted and serviceId to Channel
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "isRestricted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "serviceId" TEXT;

-- AlterTable: Add sortOrder to GroupMember
ALTER TABLE "GroupMember" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: GroupRole (custom role tags for groups)
CREATE TABLE IF NOT EXISTS "GroupRole" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#808080',
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable: GroupMemberRole (many-to-many: members <-> role tags)
CREATE TABLE IF NOT EXISTS "GroupMemberRole" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "GroupMemberRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ChannelRoleAccess (which roles can see a restricted channel)
CREATE TABLE IF NOT EXISTS "ChannelRoleAccess" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "ChannelRoleAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Channel_serviceId_idx" ON "Channel"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GroupRole_groupId_name_key" ON "GroupRole"("groupId", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GroupRole_groupId_idx" ON "GroupRole"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GroupMemberRole_memberId_roleId_key" ON "GroupMemberRole"("memberId", "roleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GroupMemberRole_roleId_idx" ON "GroupMemberRole"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChannelRoleAccess_channelId_roleId_key" ON "ChannelRoleAccess"("channelId", "roleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ChannelRoleAccess_channelId_idx" ON "ChannelRoleAccess"("channelId");

-- AddForeignKey
ALTER TABLE "GroupRole" ADD CONSTRAINT "GroupRole_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMemberRole" ADD CONSTRAINT "GroupMemberRole_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "GroupMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMemberRole" ADD CONSTRAINT "GroupMemberRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "GroupRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelRoleAccess" ADD CONSTRAINT "ChannelRoleAccess_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelRoleAccess" ADD CONSTRAINT "ChannelRoleAccess_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "GroupRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
