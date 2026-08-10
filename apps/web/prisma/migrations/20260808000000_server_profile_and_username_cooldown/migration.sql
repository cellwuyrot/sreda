-- SERVER-PROFILE: «профиль сервера» участника (имя/аватар/фон свои для каждой
-- группы) и кулдаун самостоятельной смены ника (администратора не касается).

ALTER TABLE "User" ADD COLUMN "usernameChangedAt" TIMESTAMP(3);

ALTER TABLE "GroupMember" ADD COLUMN "displayName" VARCHAR(50);
ALTER TABLE "GroupMember" ADD COLUMN "avatar" TEXT;
ALTER TABLE "GroupMember" ADD COLUMN "profileBanner" TEXT;
