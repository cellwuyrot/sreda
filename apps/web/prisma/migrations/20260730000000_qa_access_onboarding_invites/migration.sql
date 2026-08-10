-- FIX-QAACL + FIX-ONBSEND
--
-- 1. Раздел «Вопросы-ответы» получает раздельные права: кто может задавать
--    вопросы (askAccess) и кто может отвечать (answerAccess). Значения
--    ALL | MOD | ADMIN | ROLES. Режим ROLES опирается на теги группы.
-- 2. ChannelRoleAccess хранит теперь три независимых списка тегов. Столбец
--    scope со значением по умолчанию 'VIEW' сохраняет прежнее поведение всех
--    существующих строк: они остаются списком «кто видит закрытый раздел».
-- 3. OnboardingInvite — адресная рассылка онбординг-формы участникам и тегам.
--
-- ВАЖНО про пункт 3. Таблицы OnboardingForm и OnboardingApplication есть в
-- schema.prisma и в рабочей базе, но НИ ОДНА миграция их не создаёт — когда-то
-- их завели через `prisma db push`, минуя историю. Поэтому на чистой базе
-- `prisma migrate deploy` до них не доходит, и внешний ключ на OnboardingForm
-- падает с «relation does not exist» (что и произошло на CI). Ниже эта дыра
-- закрывается: обе таблицы создаются, если их нет. На рабочей базе команды
-- ничего не меняют — там таблицы уже на месте.

-- ─────────────────────────── 1. Права Q&A ───────────────────────────

ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "askAccess" TEXT NOT NULL DEFAULT 'ALL';
ALTER TABLE "Channel" ADD COLUMN IF NOT EXISTS "answerAccess" TEXT NOT NULL DEFAULT 'ALL';

ALTER TABLE "ChannelRoleAccess" ADD COLUMN IF NOT EXISTS "scope" TEXT NOT NULL DEFAULT 'VIEW';

-- Уникальность расширяется третьим полем: одна роль может присутствовать в
-- разных списках одного канала. Prisma создаёт @@unique как уникальный индекс,
-- но на всякий случай снимаем и вариант «ограничение» — обе команды идемпотентны.
ALTER TABLE "ChannelRoleAccess" DROP CONSTRAINT IF EXISTS "ChannelRoleAccess_channelId_roleId_key";
DROP INDEX IF EXISTS "ChannelRoleAccess_channelId_roleId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ChannelRoleAccess_channelId_roleId_scope_key"
  ON "ChannelRoleAccess" ("channelId", "roleId", "scope");

-- ──────────── 2. Досоздание таблиц онбординга (пропущены в истории) ────────────

CREATE TABLE IF NOT EXISTS "OnboardingForm" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL DEFAULT '',
    "questions" TEXT NOT NULL DEFAULT '[]',
    "roleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingForm_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OnboardingForm_groupId_key" ON "OnboardingForm" ("groupId");

CREATE TABLE IF NOT EXISTS "OnboardingApplication" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answers" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewNote" VARCHAR(300),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingApplication_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OnboardingApplication_groupId_status_idx"
  ON "OnboardingApplication" ("groupId", "status");
CREATE INDEX IF NOT EXISTS "OnboardingApplication_userId_groupId_createdAt_idx"
  ON "OnboardingApplication" ("userId", "groupId", "createdAt");

-- ─────────────────────── 3. Рассылка онбординг-формы ───────────────────────

CREATE TABLE IF NOT EXISTS "OnboardingInvite" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sentById" TEXT,
    "viaRoleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OnboardingInvite_formId_userId_key" ON "OnboardingInvite" ("formId", "userId");
CREATE INDEX IF NOT EXISTS "OnboardingInvite_groupId_createdAt_idx" ON "OnboardingInvite" ("groupId", "createdAt");
CREATE INDEX IF NOT EXISTS "OnboardingInvite_userId_idx" ON "OnboardingInvite" ("userId");

-- ───────────────────────────── 4. Внешние ключи ─────────────────────────────
--
-- Каждый ключ добавляется идемпотентно: на рабочей базе часть из них уже есть,
-- и повторный прогон не должен падать на «constraint already exists».

DO $$
BEGIN
  ALTER TABLE "OnboardingForm"
    ADD CONSTRAINT "OnboardingForm_groupId_fkey" FOREIGN KEY ("groupId")
    REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "OnboardingForm"
    ADD CONSTRAINT "OnboardingForm_roleId_fkey" FOREIGN KEY ("roleId")
    REFERENCES "GroupRole" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "OnboardingApplication"
    ADD CONSTRAINT "OnboardingApplication_formId_fkey" FOREIGN KEY ("formId")
    REFERENCES "OnboardingForm" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "OnboardingApplication"
    ADD CONSTRAINT "OnboardingApplication_groupId_fkey" FOREIGN KEY ("groupId")
    REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "OnboardingApplication"
    ADD CONSTRAINT "OnboardingApplication_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "OnboardingApplication"
    ADD CONSTRAINT "OnboardingApplication_reviewedById_fkey" FOREIGN KEY ("reviewedById")
    REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "OnboardingInvite"
    ADD CONSTRAINT "OnboardingInvite_formId_fkey" FOREIGN KEY ("formId")
    REFERENCES "OnboardingForm" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "OnboardingInvite"
    ADD CONSTRAINT "OnboardingInvite_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
