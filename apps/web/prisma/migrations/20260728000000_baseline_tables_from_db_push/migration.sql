-- ВОССТАНОВЛЕНИЕ БАЗЫ ИСТОРИИ МИГРАЦИЙ.
--
-- ── Зачем эта миграция ──────────────────────────────────────────────────────
--
-- Схема долго жила через `prisma db push`: изменения заводились прямо на
-- рабочей базе, мимо каталога migrations. Следы этого двоякие.
--
--   * Пяти таблиц не создаёт НИ ОДНА миграция — их целиком завёл db push:
--     WikiCollection, PartnerProject, PartnerProjectMessage, DmUserSetting,
--     CalendarEventSubscription. На чистой установке их просто нет, и
--     20260911000000_order_stages_by_service падает на ALTER TABLE
--     "PartnerProject".
--
--   * Ещё три таблицы миграции создают, но в УРЕЗАННОМ виде — часть колонок
--     доливалась потом тем же db push:
--         "Group"       — banner, requireRules;
--         "GroupMember" — mutedUntil, muteReason, voiceSeconds;
--         "WikiArticle" — restricted, collectionId.
--     На рабочей базе колонки есть, на чистой — нет, и код, который их читает,
--     падает уже в работе, а не при развёртывании.
--
-- Здесь и то, и другое доводится до schema.prisma: недостающие таблицы
-- создаются, недостающие колонки доливаются, следом идут индексы и внешние
-- ключи.
--
-- ── Где эта миграция стоит и почему ─────────────────────────────────────────
--
-- Дата 20260728000000 ставит её сразу после последней «старой» миграции
-- (20260723000000_channel_workspace_state) и раньше всех, что появились
-- после возврата к нормальной истории (первая — 20260729000000). До неё
-- применяются 39 миграций, и это принципиально: они уже создали 57 из 62
-- таблиц, перечисленных ниже. Слепок не заводит схему с нуля — он
-- ДОПОЛНЯЕТ то, что есть.
--
-- Раньше ставить нельзя: 20260521000000_init и его продолжения создают те же
-- таблицы обычным CREATE TABLE без IF NOT EXISTS, и на чистой базе они упали
-- бы на «relation already exists». Позже — тоже: 20260911000000 требует
-- "PartnerProject".
--
-- ── Почему у каждой колонки отдельная строка ────────────────────────────────
--
-- Это главный урок первого боевого прогона. Тогда здесь были только
-- CREATE TABLE IF NOT EXISTS, и на чистой базе миграция падала так:
--
--     ERROR: column "collectionId" does not exist   (код 42703)
--
-- Потому что к этому моменту "WikiArticle" уже создала миграция
-- 20260628000000_add_wiki_section — без collectionId, его позже добавил
-- db push. IF NOT EXISTS молча пропустил CREATE TABLE, таблица осталась
-- урезанной, а следующий CREATE INDEX по "collectionId" уткнулся в
-- отсутствующую колонку.
--
-- Отсюда правило: одного CREATE TABLE IF NOT EXISTS мало. Для каждой колонки
-- идёт отдельная проверка «есть ли она», и каждый индекс и внешний ключ
-- строится, только если все нужные колонки на месте. Так слепок верен при
-- любом состоянии базы: пустой, полной, наполовину доведённой руками.
--
-- ── Три вспомогательные функции ─────────────────────────────────────────────
--
-- Колонок 494, индексов 101, внешних ключей 98. Расписывать каждую проверку
-- отдельным DO-блоком — это пять тысяч строк почти одинакового текста, в
-- которых опечатка не видна. Поэтому проверки собраны в три функции, а ниже
-- идут только вызовы: по строке на колонку, индекс и ключ.
--
-- Функции создаются в схеме pg_temp — они живут внутри соединения, в каталоге
-- базы не остаются и в дамп не попадают; в конце файла они ещё и снимаются
-- явно. Prisma выполняет файл миграции одним соединением и одной транзакцией,
-- так что функции гарантированно доступны всем вызовам ниже.
--
-- ── Что делает слепок на рабочей базе ───────────────────────────────────────
--
-- Ничего. Все таблицы, колонки, индексы и ключи там уже есть, каждая проверка
-- отвечает «на месте» и вызов заканчивается ничем. Ни DROP, ни ALTER
-- существующих колонок, ни UPDATE здесь нет вообще: тип, NOT NULL и DEFAULT
-- уже существующей колонки не трогаются никогда, даже если они разошлись со
-- schema.prisma, — исправлять расхождение вслепую на живых данных опаснее,
-- чем оставить его видимым.
--
-- ── NOT NULL без DEFAULT ────────────────────────────────────────────────────
--
-- Добавить в непустую таблицу колонку NOT NULL без значения по умолчанию
-- нельзя физически: существующие строки нечем заполнить, PostgreSQL отвечает
-- ошибкой. Придумывать значение, которого нет в schema.prisma, и записывать
-- его в живые строки слепок не имеет права. Поэтому такая колонка получает
-- NOT NULL, только если строк в таблице нет (обычный случай — свежая
-- установка); иначе она заводится необязательной, а в лог уходит NOTICE.
-- На сегодня ни одна из недостающих колонок в этот случай не попадает: у всех
-- трёх обязательных (requireRules, voiceSeconds, restricted) есть DEFAULT,
-- остальные необязательные.
--
-- ── Чего здесь намеренно НЕТ ────────────────────────────────────────────────
--
-- Колонок, индексов и ключей, которые заводят более поздние миграции. Если
-- добавить их здесь, на чистой базе упадёт уже та миграция — её ADD COLUMN
-- без IF NOT EXISTS получит «колонка уже существует». Так исключены:
--     "Channel"."readAccess"            — 20260729000000;
--     "User"."usernameChangedAt"        — 20260808000000;
--     "GroupMember"."displayName",
--     "GroupMember"."avatar",
--     "GroupMember"."profileBanner"     — 20260808000000;
--     семь колонок "Message" (title, cover, views, draft,
--     publishAt, announcedAt, commentsClosed)
--                                       — 20260909000000;
--     "PartnerProject"."serviceId",
--     "PartnerProject"."appealId",
--     "Service"."stages"                — 20260911000000.
--
-- Обязательна эта осторожность только там, где поздний ADD COLUMN идёт без
-- IF NOT EXISTS (20260729000000, 20260808000000, 20260909000000): такой
-- получил бы «колонка уже существует» и уронил бы всю установку. Там, где
-- IF NOT EXISTS есть (20260911000000), правило соблюдается для единообразия.
-- Состояние после слепка — «как было к 20260729000000»; до schema.prisma его
-- доводят миграции, идущие следом.

CREATE FUNCTION pg_temp.baseline_add_column(
    p_table   text,
    p_column  text,
    p_type    text,
    p_notnull boolean,
    p_default text
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
    v_sql      text;
    v_has_rows boolean;
BEGIN
    -- Колонка на месте — выходим. Ни тип, ни NOT NULL, ни DEFAULT существующей
    -- колонки не трогаются: слепок только добавляет недостающее.
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_column
    ) THEN
        RETURN;
    END IF;

    v_sql := format('ALTER TABLE %I ADD COLUMN %I %s', p_table, p_column, p_type);

    IF p_default IS NOT NULL THEN
        v_sql := v_sql || ' DEFAULT ' || p_default;
    END IF;

    IF p_notnull THEN
        IF p_default IS NOT NULL THEN
            -- Есть значение по умолчанию — PostgreSQL заполнит им существующие
            -- строки, NOT NULL ставится сразу и безопасно.
            v_sql := v_sql || ' NOT NULL';
        ELSE
            -- NOT NULL без DEFAULT на непустой таблице невозможен в принципе:
            -- заполнять новую колонку нечем. Ставим ограничение, только если
            -- строк нет (обычный случай — свежая установка); иначе колонка
            -- заводится необязательной. Альтернатива — выдумать значение
            -- по умолчанию, которого нет в schema.prisma, и записать его в
            -- живые строки; для слепка, который обязан быть пустышкой на
            -- рабочей базе, это неприемлемо.
            EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I)', p_table) INTO v_has_rows;
            IF v_has_rows THEN
                RAISE NOTICE 'baseline: "%"."%" добавлена без NOT NULL — в таблице есть строки', p_table, p_column;
            ELSE
                v_sql := v_sql || ' NOT NULL';
            END IF;
        END IF;
    END IF;

    EXECUTE v_sql;
END
$fn$;

CREATE FUNCTION pg_temp.baseline_create_index(
    p_table   text,
    p_columns text[],
    p_ddl     text
) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
    IF to_regclass(format('public.%I', p_table)) IS NULL THEN
        RETURN;
    END IF;
    -- Если хоть одной колонки нет — индекс не строим. Такая колонка появится
    -- в более поздней миграции, она же построит по ней индекс.
    IF EXISTS (
        SELECT 1 FROM unnest(p_columns) AS need(name)
        WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = p_table AND column_name = need.name
        )
    ) THEN
        RETURN;
    END IF;
    EXECUTE p_ddl;
END
$fn$;

CREATE FUNCTION pg_temp.baseline_add_fk(
    p_name        text,
    p_table       text,
    p_columns     text[],
    p_ref_table   text,
    p_ref_columns text[],
    p_ddl         text
) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
    IF to_regclass(format('public.%I', p_table)) IS NULL
       OR to_regclass(format('public.%I', p_ref_table)) IS NULL THEN
        RETURN;
    END IF;
    -- У ADD CONSTRAINT нет формы IF NOT EXISTS — проверяем по pg_constraint.
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = p_name AND conrelid = to_regclass(format('public.%I', p_table))
    ) THEN
        RETURN;
    END IF;
    IF EXISTS (
        SELECT 1 FROM unnest(p_columns) AS need(name)
        WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = p_table AND column_name = need.name
        )
    ) OR EXISTS (
        SELECT 1 FROM unnest(p_ref_columns) AS need(name)
        WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = p_ref_table AND column_name = need.name
        )
    ) THEN
        RETURN;
    END IF;
    EXECUTE p_ddl;
END
$fn$;

-- ════ 1. Таблицы и их колонки ═══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "User" (
    "city" TEXT,
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "avatar" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "banned" BOOLEAN NOT NULL DEFAULT false,
    "banReason" TEXT,
    "bannedUntil" TIMESTAMP(3),
    "bio" VARCHAR(200),
    "socialLinks" TEXT,
    "customStatus" VARCHAR(100),
    "statusEmoji" VARCHAR(10),
    "statusType" VARCHAR(20) DEFAULT 'online',
    "activityEnabled" BOOLEAN NOT NULL DEFAULT false,
    "activityStatus" VARCHAR(80),
    "activityUpdatedAt" TIMESTAMP(3),
    "privacyOnline" TEXT NOT NULL DEFAULT 'everyone',
    "privacyFriends" TEXT NOT NULL DEFAULT 'everyone',
    "privacyEmail" BOOLEAN NOT NULL DEFAULT false,
    "notifySound" BOOLEAN NOT NULL DEFAULT true,
    "notifyPush" BOOLEAN NOT NULL DEFAULT true,
    "mutedGroups" TEXT,
    "mutedChannels" TEXT,
    "avatarGlowEnabled" BOOLEAN NOT NULL DEFAULT false,
    "avatarGlowColors" TEXT,
    "profileBanner" TEXT,
    "e2eePublicKey" TEXT,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "showOnline" BOOLEAN NOT NULL DEFAULT true,
    "tosAccepted" BOOLEAN NOT NULL DEFAULT false,
    "lastSeen" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('User', 'city', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('User', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('User', 'email', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('User', 'username', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('User', 'name', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('User', 'password', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('User', 'avatar', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('User', 'role', 'TEXT', true, $d$'USER'$d$);
SELECT pg_temp.baseline_add_column('User', 'emailVerified', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('User', 'banned', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('User', 'banReason', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('User', 'bannedUntil', 'TIMESTAMP(3)', false, NULL);
SELECT pg_temp.baseline_add_column('User', 'bio', 'VARCHAR(200)', false, NULL);
SELECT pg_temp.baseline_add_column('User', 'socialLinks', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('User', 'customStatus', 'VARCHAR(100)', false, NULL);
SELECT pg_temp.baseline_add_column('User', 'statusEmoji', 'VARCHAR(10)', false, NULL);
SELECT pg_temp.baseline_add_column('User', 'statusType', 'VARCHAR(20)', false, $d$'online'$d$);
SELECT pg_temp.baseline_add_column('User', 'activityEnabled', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('User', 'activityStatus', 'VARCHAR(80)', false, NULL);
SELECT pg_temp.baseline_add_column('User', 'activityUpdatedAt', 'TIMESTAMP(3)', false, NULL);
SELECT pg_temp.baseline_add_column('User', 'privacyOnline', 'TEXT', true, $d$'everyone'$d$);
SELECT pg_temp.baseline_add_column('User', 'privacyFriends', 'TEXT', true, $d$'everyone'$d$);
SELECT pg_temp.baseline_add_column('User', 'privacyEmail', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('User', 'notifySound', 'BOOLEAN', true, $d$true$d$);
SELECT pg_temp.baseline_add_column('User', 'notifyPush', 'BOOLEAN', true, $d$true$d$);
SELECT pg_temp.baseline_add_column('User', 'mutedGroups', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('User', 'mutedChannels', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('User', 'avatarGlowEnabled', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('User', 'avatarGlowColors', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('User', 'profileBanner', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('User', 'e2eePublicKey', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('User', 'isPremium', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('User', 'showOnline', 'BOOLEAN', true, $d$true$d$);
SELECT pg_temp.baseline_add_column('User', 'tosAccepted', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('User', 'lastSeen', 'TIMESTAMP(3)', false, NULL);
SELECT pg_temp.baseline_add_column('User', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('User', 'updatedAt', 'TIMESTAMP(3)', true, NULL);

CREATE TABLE IF NOT EXISTS "VerificationCode" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'register',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationCode_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('VerificationCode', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('VerificationCode', 'email', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('VerificationCode', 'code', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('VerificationCode', 'type', 'TEXT', true, $d$'register'$d$);
SELECT pg_temp.baseline_add_column('VerificationCode', 'expiresAt', 'TIMESTAMP(3)', true, NULL);
SELECT pg_temp.baseline_add_column('VerificationCode', 'used', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('VerificationCode', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "Group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "rules" TEXT NOT NULL DEFAULT '',
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "sectionsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "banner" TEXT,
    "requireRules" BOOLEAN NOT NULL DEFAULT false,
    "paused" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('Group', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Group', 'name', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Group', 'icon', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('Group', 'description', 'TEXT', true, $d$''$d$);
SELECT pg_temp.baseline_add_column('Group', 'rules', 'TEXT', true, $d$''$d$);
SELECT pg_temp.baseline_add_column('Group', 'isMain', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('Group', 'sectionsEnabled', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('Group', 'ownerId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Group', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('Group', 'updatedAt', 'TIMESTAMP(3)', true, NULL);
SELECT pg_temp.baseline_add_column('Group', 'banner', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('Group', 'requireRules', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('Group', 'paused', 'BOOLEAN', true, $d$false$d$);

CREATE TABLE IF NOT EXISTS "GroupBan" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" VARCHAR(300),
    "bannedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupBan_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('GroupBan', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GroupBan', 'groupId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GroupBan', 'userId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GroupBan', 'reason', 'VARCHAR(300)', false, NULL);
SELECT pg_temp.baseline_add_column('GroupBan', 'bannedById', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GroupBan', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "GroupMember" (
    "mutedUntil" TIMESTAMP(3),
    "muteReason" VARCHAR(300),
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "rulesAccepted" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "voiceSeconds" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('GroupMember', 'mutedUntil', 'TIMESTAMP(3)', false, NULL);
SELECT pg_temp.baseline_add_column('GroupMember', 'muteReason', 'VARCHAR(300)', false, NULL);
SELECT pg_temp.baseline_add_column('GroupMember', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GroupMember', 'userId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GroupMember', 'groupId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GroupMember', 'role', 'TEXT', true, $d$'MEMBER'$d$);
SELECT pg_temp.baseline_add_column('GroupMember', 'rulesAccepted', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('GroupMember', 'sortOrder', 'INTEGER', true, $d$0$d$);
SELECT pg_temp.baseline_add_column('GroupMember', 'muted', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('GroupMember', 'voiceSeconds', 'INTEGER', true, $d$0$d$);
SELECT pg_temp.baseline_add_column('GroupMember', 'joinedAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "Invite" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 0,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('Invite', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Invite', 'code', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Invite', 'groupId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Invite', 'createdBy', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Invite', 'maxUses', 'INTEGER', true, $d$0$d$);
SELECT pg_temp.baseline_add_column('Invite', 'uses', 'INTEGER', true, $d$0$d$);
SELECT pg_temp.baseline_add_column('Invite', 'expiresAt', 'TIMESTAMP(3)', false, NULL);
SELECT pg_temp.baseline_add_column('Invite', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "Channel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'TEXT',
    "icon" TEXT,
    "groupId" TEXT NOT NULL,
    "isRestricted" BOOLEAN NOT NULL DEFAULT false,
    "postAccess" TEXT NOT NULL DEFAULT 'ALL',
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "slowmode" INTEGER NOT NULL DEFAULT 0,
    "serviceId" TEXT,
    "parentId" TEXT,
    "channelGroupType" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('Channel', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Channel', 'name', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Channel', 'type', 'TEXT', true, $d$'TEXT'$d$);
SELECT pg_temp.baseline_add_column('Channel', 'icon', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('Channel', 'groupId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Channel', 'isRestricted', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('Channel', 'postAccess', 'TEXT', true, $d$'ALL'$d$);
SELECT pg_temp.baseline_add_column('Channel', 'hidden', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('Channel', 'slowmode', 'INTEGER', true, $d$0$d$);
SELECT pg_temp.baseline_add_column('Channel', 'serviceId', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('Channel', 'parentId', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('Channel', 'channelGroupType', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('Channel', 'sortOrder', 'INTEGER', true, $d$0$d$);
SELECT pg_temp.baseline_add_column('Channel', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('Channel', 'updatedAt', 'TIMESTAMP(3)', true, NULL);

CREATE TABLE IF NOT EXISTS "ChannelMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRead" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelMember_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('ChannelMember', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('ChannelMember', 'userId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('ChannelMember', 'channelId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('ChannelMember', 'role', 'TEXT', true, $d$'MEMBER'$d$);
SELECT pg_temp.baseline_add_column('ChannelMember', 'joinedAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('ChannelMember', 'lastRead', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "Message" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" TIMESTAMP(3),
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "pinnedBy" TEXT,
    "pinnedAt" TIMESTAMP(3),
    "replyToId" TEXT,
    "threadId" TEXT,
    "threadCount" INTEGER NOT NULL DEFAULT 0,
    "attachments" TEXT,
    "mentions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('Message', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Message', 'content', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Message', 'userId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Message', 'channelId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Message', 'edited', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('Message', 'editedAt', 'TIMESTAMP(3)', false, NULL);
SELECT pg_temp.baseline_add_column('Message', 'deleted', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('Message', 'pinned', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('Message', 'pinnedBy', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('Message', 'pinnedAt', 'TIMESTAMP(3)', false, NULL);
SELECT pg_temp.baseline_add_column('Message', 'replyToId', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('Message', 'threadId', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('Message', 'threadCount', 'INTEGER', true, $d$0$d$);
SELECT pg_temp.baseline_add_column('Message', 'attachments', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('Message', 'mentions', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('Message', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "Reaction" (
    "id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reaction_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('Reaction', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Reaction', 'emoji', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Reaction', 'userId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Reaction', 'messageId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Reaction', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "DirectConversation" (
    "id" TEXT NOT NULL,
    "user1Id" TEXT NOT NULL,
    "user2Id" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "user1ReadAt" TIMESTAMP(3),
    "user2ReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectConversation_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('DirectConversation', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('DirectConversation', 'user1Id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('DirectConversation', 'user2Id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('DirectConversation', 'lastMessageAt', 'TIMESTAMP(3)', false, NULL);
SELECT pg_temp.baseline_add_column('DirectConversation', 'user1ReadAt', 'TIMESTAMP(3)', false, NULL);
SELECT pg_temp.baseline_add_column('DirectConversation', 'user2ReadAt', 'TIMESTAMP(3)', false, NULL);
SELECT pg_temp.baseline_add_column('DirectConversation', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('DirectConversation', 'updatedAt', 'TIMESTAMP(3)', true, NULL);

CREATE TABLE IF NOT EXISTS "DirectMessage" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" TIMESTAMP(3),
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "attachments" TEXT,
    "replyToId" TEXT,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('DirectMessage', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('DirectMessage', 'content', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('DirectMessage', 'userId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('DirectMessage', 'conversationId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('DirectMessage', 'edited', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('DirectMessage', 'editedAt', 'TIMESTAMP(3)', false, NULL);
SELECT pg_temp.baseline_add_column('DirectMessage', 'deleted', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('DirectMessage', 'attachments', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('DirectMessage', 'replyToId', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('DirectMessage', 'encrypted', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('DirectMessage', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

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
SELECT pg_temp.baseline_add_column('Badge', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Badge', 'name', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Badge', 'description', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Badge', 'icon', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('Badge', 'imageUrl', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('Badge', 'rarity', 'TEXT', true, $d$'common'$d$);
SELECT pg_temp.baseline_add_column('Badge', 'active', 'BOOLEAN', true, $d$true$d$);
SELECT pg_temp.baseline_add_column('Badge', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('Badge', 'updatedAt', 'TIMESTAMP(3)', true, NULL);

CREATE TABLE IF NOT EXISTS "UserBadge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "awardedBy" TEXT,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBadge_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('UserBadge', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('UserBadge', 'userId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('UserBadge', 'badgeId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('UserBadge', 'awardedBy', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('UserBadge', 'awardedAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

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
SELECT pg_temp.baseline_add_column('UserSession', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('UserSession', 'userId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('UserSession', 'userAgent', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('UserSession', 'ip', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('UserSession', 'token', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('UserSession', 'active', 'BOOLEAN', true, $d$true$d$);
SELECT pg_temp.baseline_add_column('UserSession', 'lastUsed', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('UserSession', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "Article" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('Article', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Article', 'title', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Article', 'slug', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Article', 'content', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Article', 'category', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Article', 'tags', 'TEXT', true, $d$''$d$);
SELECT pg_temp.baseline_add_column('Article', 'published', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('Article', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('Article', 'updatedAt', 'TIMESTAMP(3)', true, NULL);

CREATE TABLE IF NOT EXISTS "Service" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('Service', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Service', 'title', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Service', 'description', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Service', 'icon', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('Service', 'order', 'INTEGER', true, $d$0$d$);
SELECT pg_temp.baseline_add_column('Service', 'active', 'BOOLEAN', true, $d$true$d$);

CREATE TABLE IF NOT EXISTS "GroupRole" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#808080',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupRole_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('GroupRole', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GroupRole', 'name', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GroupRole', 'color', 'TEXT', true, $d$'#808080'$d$);
SELECT pg_temp.baseline_add_column('GroupRole', 'priority', 'INTEGER', true, $d$0$d$);
SELECT pg_temp.baseline_add_column('GroupRole', 'groupId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GroupRole', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "GroupMemberRole" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "GroupMemberRole_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('GroupMemberRole', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GroupMemberRole', 'memberId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GroupMemberRole', 'roleId', 'TEXT', true, NULL);

CREATE TABLE IF NOT EXISTS "ChannelRoleAccess" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "ChannelRoleAccess_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('ChannelRoleAccess', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('ChannelRoleAccess', 'channelId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('ChannelRoleAccess', 'roleId', 'TEXT', true, NULL);

CREATE TABLE IF NOT EXISTS "EcosystemItem" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "imageUrl" TEXT,
    "linkUrl" TEXT,
    "section" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "EcosystemItem_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('EcosystemItem', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('EcosystemItem', 'title', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('EcosystemItem', 'description', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('EcosystemItem', 'imageUrl', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('EcosystemItem', 'linkUrl', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('EcosystemItem', 'section', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('EcosystemItem', 'order', 'INTEGER', true, $d$0$d$);
SELECT pg_temp.baseline_add_column('EcosystemItem', 'active', 'BOOLEAN', true, $d$true$d$);

CREATE TABLE IF NOT EXISTS "WindowConfig" (
    "id" TEXT NOT NULL,
    "windowKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "href" TEXT NOT NULL DEFAULT '',
    "accentColor" TEXT NOT NULL DEFAULT '#ff4444',
    "backgroundUrl" TEXT,
    "backgroundType" TEXT NOT NULL DEFAULT 'gradient',
    "gradientFrom" TEXT NOT NULL DEFAULT '#1a0000',
    "gradientTo" TEXT NOT NULL DEFAULT '#0a0a0f',
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "WindowConfig_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('WindowConfig', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('WindowConfig', 'windowKey', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('WindowConfig', 'title', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('WindowConfig', 'subtitle', 'TEXT', true, $d$''$d$);
SELECT pg_temp.baseline_add_column('WindowConfig', 'description', 'TEXT', true, $d$''$d$);
SELECT pg_temp.baseline_add_column('WindowConfig', 'href', 'TEXT', true, $d$''$d$);
SELECT pg_temp.baseline_add_column('WindowConfig', 'accentColor', 'TEXT', true, $d$'#ff4444'$d$);
SELECT pg_temp.baseline_add_column('WindowConfig', 'backgroundUrl', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('WindowConfig', 'backgroundType', 'TEXT', true, $d$'gradient'$d$);
SELECT pg_temp.baseline_add_column('WindowConfig', 'gradientFrom', 'TEXT', true, $d$'#1a0000'$d$);
SELECT pg_temp.baseline_add_column('WindowConfig', 'gradientTo', 'TEXT', true, $d$'#0a0a0f'$d$);
SELECT pg_temp.baseline_add_column('WindowConfig', 'order', 'INTEGER', true, $d$0$d$);
SELECT pg_temp.baseline_add_column('WindowConfig', 'active', 'BOOLEAN', true, $d$true$d$);

CREATE TABLE IF NOT EXISTS "SiteConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "SiteConfig_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('SiteConfig', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('SiteConfig', 'key', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('SiteConfig', 'value', 'TEXT', true, NULL);

CREATE TABLE IF NOT EXISTS "PremiumSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'month',
    "paymentMethod" TEXT NOT NULL DEFAULT 'manual',
    "amount" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "reference" VARCHAR(200),
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PremiumSubscription_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('PremiumSubscription', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('PremiumSubscription', 'userId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('PremiumSubscription', 'plan', 'TEXT', true, $d$'month'$d$);
SELECT pg_temp.baseline_add_column('PremiumSubscription', 'paymentMethod', 'TEXT', true, $d$'manual'$d$);
SELECT pg_temp.baseline_add_column('PremiumSubscription', 'amount', 'INTEGER', true, $d$0$d$);
SELECT pg_temp.baseline_add_column('PremiumSubscription', 'currency', 'TEXT', true, $d$'RUB'$d$);
SELECT pg_temp.baseline_add_column('PremiumSubscription', 'reference', 'VARCHAR(200)', false, NULL);
SELECT pg_temp.baseline_add_column('PremiumSubscription', 'note', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('PremiumSubscription', 'status', 'TEXT', true, $d$'active'$d$);
SELECT pg_temp.baseline_add_column('PremiumSubscription', 'startedAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('PremiumSubscription', 'expiresAt', 'TIMESTAMP(3)', false, NULL);
SELECT pg_temp.baseline_add_column('PremiumSubscription', 'grantedById', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('PremiumSubscription', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('PremiumSubscription', 'updatedAt', 'TIMESTAMP(3)', true, NULL);

CREATE TABLE IF NOT EXISTS "AiChat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Новый диалог',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiChat_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('AiChat', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('AiChat', 'userId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('AiChat', 'title', 'TEXT', true, $d$'Новый диалог'$d$);
SELECT pg_temp.baseline_add_column('AiChat', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('AiChat', 'updatedAt', 'TIMESTAMP(3)', true, NULL);

CREATE TABLE IF NOT EXISTS "Friendship" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('Friendship', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Friendship', 'senderId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Friendship', 'receiverId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Friendship', 'status', 'TEXT', true, $d$'PENDING'$d$);
SELECT pg_temp.baseline_add_column('Friendship', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('Friendship', 'updatedAt', 'TIMESTAMP(3)', true, NULL);

CREATE TABLE IF NOT EXISTS "GameRoom" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LOBBY',
    "gameType" TEXT NOT NULL DEFAULT 'velderan',
    "maxPlayers" INTEGER NOT NULL DEFAULT 6,
    "inviteCode" TEXT NOT NULL,
    "gameState" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameRoom_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('GameRoom', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GameRoom', 'name', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GameRoom', 'hostId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GameRoom', 'status', 'TEXT', true, $d$'LOBBY'$d$);
SELECT pg_temp.baseline_add_column('GameRoom', 'gameType', 'TEXT', true, $d$'velderan'$d$);
SELECT pg_temp.baseline_add_column('GameRoom', 'maxPlayers', 'INTEGER', true, $d$6$d$);
SELECT pg_temp.baseline_add_column('GameRoom', 'inviteCode', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GameRoom', 'gameState', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('GameRoom', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('GameRoom', 'updatedAt', 'TIMESTAMP(3)', true, NULL);

CREATE TABLE IF NOT EXISTS "GamePlayer" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "faction" TEXT,
    "color" TEXT,
    "isReady" BOOLEAN NOT NULL DEFAULT false,
    "turnOrder" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GamePlayer_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('GamePlayer', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GamePlayer', 'roomId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GamePlayer', 'userId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GamePlayer', 'faction', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('GamePlayer', 'color', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('GamePlayer', 'isReady', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('GamePlayer', 'turnOrder', 'INTEGER', true, $d$0$d$);
SELECT pg_temp.baseline_add_column('GamePlayer', 'joinedAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "GameInvite" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameInvite_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('GameInvite', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GameInvite', 'roomId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GameInvite', 'inviterId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GameInvite', 'inviteeId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GameInvite', 'status', 'TEXT', true, $d$'PENDING'$d$);
SELECT pg_temp.baseline_add_column('GameInvite', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "AiMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('AiMessage', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('AiMessage', 'chatId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('AiMessage', 'role', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('AiMessage', 'content', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('AiMessage', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "targetId" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('AuditLog', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('AuditLog', 'userId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('AuditLog', 'username', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('AuditLog', 'action', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('AuditLog', 'target', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('AuditLog', 'targetId', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('AuditLog', 'details', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('AuditLog', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "Poll" (
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
SELECT pg_temp.baseline_add_column('Poll', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Poll', 'channelId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Poll', 'userId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Poll', 'question', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Poll', 'anonymous', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('Poll', 'multiple', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('Poll', 'closed', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('Poll', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "PollOption" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "PollOption_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('PollOption', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('PollOption', 'pollId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('PollOption', 'text', 'TEXT', true, NULL);

CREATE TABLE IF NOT EXISTS "PollVote" (
    "id" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "PollVote_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('PollVote', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('PollVote', 'optionId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('PollVote', 'userId', 'TEXT', true, NULL);

CREATE TABLE IF NOT EXISTS "ChannelTask" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "number" INTEGER NOT NULL DEFAULT 0,
    "creatorId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "dueDate" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "tags" TEXT NOT NULL DEFAULT '',
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelTask_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('ChannelTask', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('ChannelTask', 'channelId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('ChannelTask', 'number', 'INTEGER', true, $d$0$d$);
SELECT pg_temp.baseline_add_column('ChannelTask', 'creatorId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('ChannelTask', 'assigneeId', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('ChannelTask', 'title', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('ChannelTask', 'description', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('ChannelTask', 'status', 'TEXT', true, $d$'open'$d$);
SELECT pg_temp.baseline_add_column('ChannelTask', 'priority', 'TEXT', true, $d$'normal'$d$);
SELECT pg_temp.baseline_add_column('ChannelTask', 'dueDate', 'TIMESTAMP(3)', false, NULL);
SELECT pg_temp.baseline_add_column('ChannelTask', 'closedAt', 'TIMESTAMP(3)', false, NULL);
SELECT pg_temp.baseline_add_column('ChannelTask', 'closedById', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('ChannelTask', 'tags', 'TEXT', true, $d$''$d$);
SELECT pg_temp.baseline_add_column('ChannelTask', 'parentId', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('ChannelTask', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('ChannelTask', 'updatedAt', 'TIMESTAMP(3)', true, NULL);

CREATE TABLE IF NOT EXISTS "TaskChecklistItem" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskChecklistItem_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('TaskChecklistItem', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('TaskChecklistItem', 'taskId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('TaskChecklistItem', 'text', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('TaskChecklistItem', 'done', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('TaskChecklistItem', 'order', 'INTEGER', true, $d$0$d$);
SELECT pg_temp.baseline_add_column('TaskChecklistItem', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('TaskChecklistItem', 'updatedAt', 'TIMESTAMP(3)', true, NULL);

CREATE TABLE IF NOT EXISTS "TaskAttachment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('TaskAttachment', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('TaskAttachment', 'taskId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('TaskAttachment', 'uploaderId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('TaskAttachment', 'name', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('TaskAttachment', 'url', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('TaskAttachment', 'mime', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('TaskAttachment', 'size', 'INTEGER', true, NULL);
SELECT pg_temp.baseline_add_column('TaskAttachment', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "TaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mentions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('TaskComment', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('TaskComment', 'taskId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('TaskComment', 'authorId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('TaskComment', 'content', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('TaskComment', 'mentions', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('TaskComment', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('TaskComment', 'updatedAt', 'TIMESTAMP(3)', true, NULL);

CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('Notification', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Notification', 'userId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Notification', 'type', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Notification', 'title', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Notification', 'body', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('Notification', 'link', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('Notification', 'read', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('Notification', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "ChannelMute" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "muted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ChannelMute_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('ChannelMute', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('ChannelMute', 'userId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('ChannelMute', 'channelId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('ChannelMute', 'muted', 'BOOLEAN', true, $d$false$d$);

CREATE TABLE IF NOT EXISTS "MessageRead" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageRead_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('MessageRead', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('MessageRead', 'userId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('MessageRead', 'messageId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('MessageRead', 'readAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "ScheduledMessage" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledMessage_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('ScheduledMessage', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('ScheduledMessage', 'content', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('ScheduledMessage', 'userId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('ScheduledMessage', 'channelId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('ScheduledMessage', 'scheduledAt', 'TIMESTAMP(3)', true, NULL);
SELECT pg_temp.baseline_add_column('ScheduledMessage', 'sent', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('ScheduledMessage', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "QAThread" (
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
SELECT pg_temp.baseline_add_column('QAThread', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('QAThread', 'channelId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('QAThread', 'authorId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('QAThread', 'title', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('QAThread', 'body', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('QAThread', 'status', 'TEXT', true, $d$'OPEN'$d$);
SELECT pg_temp.baseline_add_column('QAThread', 'tags', 'TEXT', true, $d$''$d$);
SELECT pg_temp.baseline_add_column('QAThread', 'acceptedAnswerId', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('QAThread', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('QAThread', 'updatedAt', 'TIMESTAMP(3)', true, NULL);

CREATE TABLE IF NOT EXISTS "QAAnswer" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QAAnswer_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('QAAnswer', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('QAAnswer', 'threadId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('QAAnswer', 'authorId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('QAAnswer', 'body', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('QAAnswer', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('QAAnswer', 'updatedAt', 'TIMESTAMP(3)', true, NULL);

CREATE TABLE IF NOT EXISTS "QAVote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT,
    "answerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QAVote_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('QAVote', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('QAVote', 'userId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('QAVote', 'threadId', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('QAVote', 'answerId', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('QAVote', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "WikiArticle" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "term" TEXT,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "collectionId" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WikiArticle_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('WikiArticle', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('WikiArticle', 'channelId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('WikiArticle', 'title', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('WikiArticle', 'term', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('WikiArticle', 'slug', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('WikiArticle', 'content', 'TEXT', true, $d$''$d$);
SELECT pg_temp.baseline_add_column('WikiArticle', 'category', 'TEXT', true, $d$''$d$);
SELECT pg_temp.baseline_add_column('WikiArticle', 'restricted', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('WikiArticle', 'collectionId', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('WikiArticle', 'updatedById', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('WikiArticle', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('WikiArticle', 'updatedAt', 'TIMESTAMP(3)', true, NULL);

CREATE TABLE IF NOT EXISTS "WikiCollection" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'GROUP',
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WikiCollection_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('WikiCollection', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('WikiCollection', 'channelId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('WikiCollection', 'name', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('WikiCollection', 'kind', 'TEXT', true, $d$'GROUP'$d$);
SELECT pg_temp.baseline_add_column('WikiCollection', 'restricted', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('WikiCollection', 'sortOrder', 'INTEGER', true, $d$0$d$);
SELECT pg_temp.baseline_add_column('WikiCollection', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "WikiRevision" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "editorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WikiRevision_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('WikiRevision', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('WikiRevision', 'articleId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('WikiRevision', 'content', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('WikiRevision', 'editorId', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('WikiRevision', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "CalendarEvent" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('CalendarEvent', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('CalendarEvent', 'channelId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('CalendarEvent', 'authorId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('CalendarEvent', 'title', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('CalendarEvent', 'description', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('CalendarEvent', 'location', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('CalendarEvent', 'color', 'TEXT', true, $d$'#3b82f6'$d$);
SELECT pg_temp.baseline_add_column('CalendarEvent', 'allDay', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('CalendarEvent', 'start', 'TIMESTAMP(3)', true, NULL);
SELECT pg_temp.baseline_add_column('CalendarEvent', 'end', 'TIMESTAMP(3)', false, NULL);
SELECT pg_temp.baseline_add_column('CalendarEvent', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('CalendarEvent', 'updatedAt', 'TIMESTAMP(3)', true, NULL);

CREATE TABLE IF NOT EXISTS "WorkspaceFile" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceFile_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('WorkspaceFile', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('WorkspaceFile', 'channelId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('WorkspaceFile', 'uploaderId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('WorkspaceFile', 'name', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('WorkspaceFile', 'url', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('WorkspaceFile', 'mime', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('WorkspaceFile', 'size', 'INTEGER', true, NULL);
SELECT pg_temp.baseline_add_column('WorkspaceFile', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "Appeal" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appeal_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('Appeal', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Appeal', 'channelId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Appeal', 'authorId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Appeal', 'subject', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Appeal', 'body', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('Appeal', 'category', 'TEXT', true, $d$''$d$);
SELECT pg_temp.baseline_add_column('Appeal', 'status', 'TEXT', true, $d$'OPEN'$d$);
SELECT pg_temp.baseline_add_column('Appeal', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('Appeal', 'updatedAt', 'TIMESTAMP(3)', true, NULL);

CREATE TABLE IF NOT EXISTS "AppealMessage" (
    "id" TEXT NOT NULL,
    "appealId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppealMessage_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('AppealMessage', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('AppealMessage', 'appealId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('AppealMessage', 'authorId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('AppealMessage', 'body', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('AppealMessage', 'isAdmin', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('AppealMessage', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "WorkspaceState" (
    "userId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceState_pkey" PRIMARY KEY ("userId")
);
SELECT pg_temp.baseline_add_column('WorkspaceState', 'userId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('WorkspaceState', 'data', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('WorkspaceState', 'updatedAt', 'TIMESTAMP(3)', true, NULL);

CREATE TABLE IF NOT EXISTS "ChannelWorkspaceState" (
    "channelId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelWorkspaceState_pkey" PRIMARY KEY ("channelId")
);
SELECT pg_temp.baseline_add_column('ChannelWorkspaceState', 'channelId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('ChannelWorkspaceState', 'data', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('ChannelWorkspaceState', 'updatedById', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('ChannelWorkspaceState', 'updatedAt', 'TIMESTAMP(3)', true, NULL);

CREATE TABLE IF NOT EXISTS "GroupLayout" (
    "userId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupLayout_pkey" PRIMARY KEY ("userId")
);
SELECT pg_temp.baseline_add_column('GroupLayout', 'userId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GroupLayout', 'data', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GroupLayout', 'updatedAt', 'TIMESTAMP(3)', true, NULL);

CREATE TABLE IF NOT EXISTS "GroupAuditEntry" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "targetName" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupAuditEntry_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('GroupAuditEntry', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GroupAuditEntry', 'groupId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GroupAuditEntry', 'actorId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GroupAuditEntry', 'actorName', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GroupAuditEntry', 'action', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('GroupAuditEntry', 'targetId', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('GroupAuditEntry', 'targetName', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('GroupAuditEntry', 'details', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('GroupAuditEntry', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "UserIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserIdentity_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('UserIdentity', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('UserIdentity', 'userId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('UserIdentity', 'kind', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('UserIdentity', 'value', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('UserIdentity', 'lastSeen', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "BlockedIdentity" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "userId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedIdentity_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('BlockedIdentity', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('BlockedIdentity', 'kind', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('BlockedIdentity', 'value', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('BlockedIdentity', 'userId', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('BlockedIdentity', 'reason', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('BlockedIdentity', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "PartnerProject" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "domain" TEXT NOT NULL DEFAULT '',
    "stepsDone" JSONB NOT NULL DEFAULT '[]',
    "files" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerProject_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('PartnerProject', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('PartnerProject', 'ownerId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('PartnerProject', 'name', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('PartnerProject', 'purpose', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('PartnerProject', 'domain', 'TEXT', true, $d$''$d$);
SELECT pg_temp.baseline_add_column('PartnerProject', 'stepsDone', 'JSONB', true, $d$'[]'$d$);
SELECT pg_temp.baseline_add_column('PartnerProject', 'files', 'JSONB', true, $d$'[]'$d$);
SELECT pg_temp.baseline_add_column('PartnerProject', 'status', 'TEXT', true, $d$'NEW'$d$);
SELECT pg_temp.baseline_add_column('PartnerProject', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('PartnerProject', 'updatedAt', 'TIMESTAMP(3)', true, NULL);

CREATE TABLE IF NOT EXISTS "PartnerProjectMessage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isStaff" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerProjectMessage_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('PartnerProjectMessage', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('PartnerProjectMessage', 'projectId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('PartnerProjectMessage', 'authorId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('PartnerProjectMessage', 'body', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('PartnerProjectMessage', 'isStaff', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('PartnerProjectMessage', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

CREATE TABLE IF NOT EXISTS "DmUserSetting" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "blacklisted" BOOLEAN NOT NULL DEFAULT false,
    "voiceBan" BOOLEAN NOT NULL DEFAULT false,
    "autoReplyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoReplyText" TEXT,
    "lastAutoReplyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DmUserSetting_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('DmUserSetting', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('DmUserSetting', 'ownerId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('DmUserSetting', 'targetId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('DmUserSetting', 'blacklisted', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('DmUserSetting', 'voiceBan', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('DmUserSetting', 'autoReplyEnabled', 'BOOLEAN', true, $d$false$d$);
SELECT pg_temp.baseline_add_column('DmUserSetting', 'autoReplyText', 'TEXT', false, NULL);
SELECT pg_temp.baseline_add_column('DmUserSetting', 'lastAutoReplyAt', 'TIMESTAMP(3)', false, NULL);
SELECT pg_temp.baseline_add_column('DmUserSetting', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);
SELECT pg_temp.baseline_add_column('DmUserSetting', 'updatedAt', 'TIMESTAMP(3)', true, NULL);

CREATE TABLE IF NOT EXISTS "CalendarEventSubscription" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "remindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEventSubscription_pkey" PRIMARY KEY ("id")
);
SELECT pg_temp.baseline_add_column('CalendarEventSubscription', 'id', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('CalendarEventSubscription', 'eventId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('CalendarEventSubscription', 'userId', 'TEXT', true, NULL);
SELECT pg_temp.baseline_add_column('CalendarEventSubscription', 'remindedAt', 'TIMESTAMP(3)', false, NULL);
SELECT pg_temp.baseline_add_column('CalendarEventSubscription', 'createdAt', 'TIMESTAMP(3)', true, $d$CURRENT_TIMESTAMP$d$);

-- ════ 2. Индексы ════════════════════════════════════════════════════════════

SELECT pg_temp.baseline_create_index('User', ARRAY['email'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email")$d$);
SELECT pg_temp.baseline_create_index('User', ARRAY['username'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username")$d$);
SELECT pg_temp.baseline_create_index('User', ARRAY['email'],
    $d$CREATE INDEX IF NOT EXISTS "User_email_idx" ON "User"("email")$d$);
SELECT pg_temp.baseline_create_index('User', ARRAY['username'],
    $d$CREATE INDEX IF NOT EXISTS "User_username_idx" ON "User"("username")$d$);
SELECT pg_temp.baseline_create_index('VerificationCode', ARRAY['email', 'code'],
    $d$CREATE INDEX IF NOT EXISTS "VerificationCode_email_code_idx" ON "VerificationCode"("email", "code")$d$);
SELECT pg_temp.baseline_create_index('GroupBan', ARRAY['userId'],
    $d$CREATE INDEX IF NOT EXISTS "GroupBan_userId_idx" ON "GroupBan"("userId")$d$);
SELECT pg_temp.baseline_create_index('GroupBan', ARRAY['groupId', 'userId'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "GroupBan_groupId_userId_key" ON "GroupBan"("groupId", "userId")$d$);
SELECT pg_temp.baseline_create_index('GroupMember', ARRAY['userId', 'groupId'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "GroupMember_userId_groupId_key" ON "GroupMember"("userId", "groupId")$d$);
SELECT pg_temp.baseline_create_index('Invite', ARRAY['code'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "Invite_code_key" ON "Invite"("code")$d$);
SELECT pg_temp.baseline_create_index('Channel', ARRAY['groupId'],
    $d$CREATE INDEX IF NOT EXISTS "Channel_groupId_idx" ON "Channel"("groupId")$d$);
SELECT pg_temp.baseline_create_index('Channel', ARRAY['serviceId'],
    $d$CREATE INDEX IF NOT EXISTS "Channel_serviceId_idx" ON "Channel"("serviceId")$d$);
SELECT pg_temp.baseline_create_index('Channel', ARRAY['parentId'],
    $d$CREATE INDEX IF NOT EXISTS "Channel_parentId_idx" ON "Channel"("parentId")$d$);
SELECT pg_temp.baseline_create_index('ChannelMember', ARRAY['userId', 'channelId'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "ChannelMember_userId_channelId_key" ON "ChannelMember"("userId", "channelId")$d$);
SELECT pg_temp.baseline_create_index('Message', ARRAY['channelId', 'createdAt'],
    $d$CREATE INDEX IF NOT EXISTS "Message_channelId_createdAt_idx" ON "Message"("channelId", "createdAt")$d$);
SELECT pg_temp.baseline_create_index('Message', ARRAY['replyToId'],
    $d$CREATE INDEX IF NOT EXISTS "Message_replyToId_idx" ON "Message"("replyToId")$d$);
SELECT pg_temp.baseline_create_index('Message', ARRAY['threadId'],
    $d$CREATE INDEX IF NOT EXISTS "Message_threadId_idx" ON "Message"("threadId")$d$);
SELECT pg_temp.baseline_create_index('Reaction', ARRAY['messageId'],
    $d$CREATE INDEX IF NOT EXISTS "Reaction_messageId_idx" ON "Reaction"("messageId")$d$);
SELECT pg_temp.baseline_create_index('Reaction', ARRAY['userId', 'messageId', 'emoji'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "Reaction_userId_messageId_emoji_key" ON "Reaction"("userId", "messageId", "emoji")$d$);
SELECT pg_temp.baseline_create_index('DirectConversation', ARRAY['user1Id'],
    $d$CREATE INDEX IF NOT EXISTS "DirectConversation_user1Id_idx" ON "DirectConversation"("user1Id")$d$);
SELECT pg_temp.baseline_create_index('DirectConversation', ARRAY['user2Id'],
    $d$CREATE INDEX IF NOT EXISTS "DirectConversation_user2Id_idx" ON "DirectConversation"("user2Id")$d$);
SELECT pg_temp.baseline_create_index('DirectMessage', ARRAY['conversationId', 'createdAt'],
    $d$CREATE INDEX IF NOT EXISTS "DirectMessage_conversationId_createdAt_idx" ON "DirectMessage"("conversationId", "createdAt")$d$);
SELECT pg_temp.baseline_create_index('DirectMessage', ARRAY['replyToId'],
    $d$CREATE INDEX IF NOT EXISTS "DirectMessage_replyToId_idx" ON "DirectMessage"("replyToId")$d$);
SELECT pg_temp.baseline_create_index('UserBadge', ARRAY['userId'],
    $d$CREATE INDEX IF NOT EXISTS "UserBadge_userId_idx" ON "UserBadge"("userId")$d$);
SELECT pg_temp.baseline_create_index('UserBadge', ARRAY['userId', 'badgeId'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "UserBadge_userId_badgeId_key" ON "UserBadge"("userId", "badgeId")$d$);
SELECT pg_temp.baseline_create_index('UserSession', ARRAY['token'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "UserSession_token_key" ON "UserSession"("token")$d$);
SELECT pg_temp.baseline_create_index('UserSession', ARRAY['userId'],
    $d$CREATE INDEX IF NOT EXISTS "UserSession_userId_idx" ON "UserSession"("userId")$d$);
SELECT pg_temp.baseline_create_index('UserSession', ARRAY['token'],
    $d$CREATE INDEX IF NOT EXISTS "UserSession_token_idx" ON "UserSession"("token")$d$);
SELECT pg_temp.baseline_create_index('Article', ARRAY['slug'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "Article_slug_key" ON "Article"("slug")$d$);
SELECT pg_temp.baseline_create_index('GroupRole', ARRAY['groupId'],
    $d$CREATE INDEX IF NOT EXISTS "GroupRole_groupId_idx" ON "GroupRole"("groupId")$d$);
SELECT pg_temp.baseline_create_index('GroupRole', ARRAY['groupId', 'name'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "GroupRole_groupId_name_key" ON "GroupRole"("groupId", "name")$d$);
SELECT pg_temp.baseline_create_index('GroupMemberRole', ARRAY['roleId'],
    $d$CREATE INDEX IF NOT EXISTS "GroupMemberRole_roleId_idx" ON "GroupMemberRole"("roleId")$d$);
SELECT pg_temp.baseline_create_index('GroupMemberRole', ARRAY['memberId', 'roleId'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "GroupMemberRole_memberId_roleId_key" ON "GroupMemberRole"("memberId", "roleId")$d$);
SELECT pg_temp.baseline_create_index('ChannelRoleAccess', ARRAY['channelId'],
    $d$CREATE INDEX IF NOT EXISTS "ChannelRoleAccess_channelId_idx" ON "ChannelRoleAccess"("channelId")$d$);
SELECT pg_temp.baseline_create_index('WindowConfig', ARRAY['windowKey'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "WindowConfig_windowKey_key" ON "WindowConfig"("windowKey")$d$);
SELECT pg_temp.baseline_create_index('SiteConfig', ARRAY['key'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "SiteConfig_key_key" ON "SiteConfig"("key")$d$);
SELECT pg_temp.baseline_create_index('PremiumSubscription', ARRAY['userId'],
    $d$CREATE INDEX IF NOT EXISTS "PremiumSubscription_userId_idx" ON "PremiumSubscription"("userId")$d$);
SELECT pg_temp.baseline_create_index('PremiumSubscription', ARRAY['status'],
    $d$CREATE INDEX IF NOT EXISTS "PremiumSubscription_status_idx" ON "PremiumSubscription"("status")$d$);
SELECT pg_temp.baseline_create_index('AiChat', ARRAY['userId'],
    $d$CREATE INDEX IF NOT EXISTS "AiChat_userId_idx" ON "AiChat"("userId")$d$);
SELECT pg_temp.baseline_create_index('Friendship', ARRAY['receiverId'],
    $d$CREATE INDEX IF NOT EXISTS "Friendship_receiverId_idx" ON "Friendship"("receiverId")$d$);
SELECT pg_temp.baseline_create_index('Friendship', ARRAY['senderId', 'receiverId'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "Friendship_senderId_receiverId_key" ON "Friendship"("senderId", "receiverId")$d$);
SELECT pg_temp.baseline_create_index('GameRoom', ARRAY['inviteCode'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "GameRoom_inviteCode_key" ON "GameRoom"("inviteCode")$d$);
SELECT pg_temp.baseline_create_index('GamePlayer', ARRAY['roomId', 'userId'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "GamePlayer_roomId_userId_key" ON "GamePlayer"("roomId", "userId")$d$);
SELECT pg_temp.baseline_create_index('GamePlayer', ARRAY['roomId', 'faction'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "GamePlayer_roomId_faction_key" ON "GamePlayer"("roomId", "faction")$d$);
SELECT pg_temp.baseline_create_index('GameInvite', ARRAY['roomId', 'inviteeId'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "GameInvite_roomId_inviteeId_key" ON "GameInvite"("roomId", "inviteeId")$d$);
SELECT pg_temp.baseline_create_index('AiMessage', ARRAY['chatId'],
    $d$CREATE INDEX IF NOT EXISTS "AiMessage_chatId_idx" ON "AiMessage"("chatId")$d$);
SELECT pg_temp.baseline_create_index('AuditLog', ARRAY['userId'],
    $d$CREATE INDEX IF NOT EXISTS "AuditLog_userId_idx" ON "AuditLog"("userId")$d$);
SELECT pg_temp.baseline_create_index('AuditLog', ARRAY['createdAt'],
    $d$CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt")$d$);
SELECT pg_temp.baseline_create_index('AuditLog', ARRAY['action'],
    $d$CREATE INDEX IF NOT EXISTS "AuditLog_action_idx" ON "AuditLog"("action")$d$);
SELECT pg_temp.baseline_create_index('Poll', ARRAY['channelId'],
    $d$CREATE INDEX IF NOT EXISTS "Poll_channelId_idx" ON "Poll"("channelId")$d$);
SELECT pg_temp.baseline_create_index('PollOption', ARRAY['pollId'],
    $d$CREATE INDEX IF NOT EXISTS "PollOption_pollId_idx" ON "PollOption"("pollId")$d$);
SELECT pg_temp.baseline_create_index('PollVote', ARRAY['optionId', 'userId'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "PollVote_optionId_userId_key" ON "PollVote"("optionId", "userId")$d$);
SELECT pg_temp.baseline_create_index('ChannelTask', ARRAY['channelId'],
    $d$CREATE INDEX IF NOT EXISTS "ChannelTask_channelId_idx" ON "ChannelTask"("channelId")$d$);
SELECT pg_temp.baseline_create_index('ChannelTask', ARRAY['assigneeId'],
    $d$CREATE INDEX IF NOT EXISTS "ChannelTask_assigneeId_idx" ON "ChannelTask"("assigneeId")$d$);
SELECT pg_temp.baseline_create_index('ChannelTask', ARRAY['status'],
    $d$CREATE INDEX IF NOT EXISTS "ChannelTask_status_idx" ON "ChannelTask"("status")$d$);
SELECT pg_temp.baseline_create_index('ChannelTask', ARRAY['parentId'],
    $d$CREATE INDEX IF NOT EXISTS "ChannelTask_parentId_idx" ON "ChannelTask"("parentId")$d$);
SELECT pg_temp.baseline_create_index('ChannelTask', ARRAY['channelId', 'number'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "ChannelTask_channelId_number_key" ON "ChannelTask"("channelId", "number")$d$);
SELECT pg_temp.baseline_create_index('TaskChecklistItem', ARRAY['taskId'],
    $d$CREATE INDEX IF NOT EXISTS "TaskChecklistItem_taskId_idx" ON "TaskChecklistItem"("taskId")$d$);
SELECT pg_temp.baseline_create_index('TaskAttachment', ARRAY['taskId'],
    $d$CREATE INDEX IF NOT EXISTS "TaskAttachment_taskId_idx" ON "TaskAttachment"("taskId")$d$);
SELECT pg_temp.baseline_create_index('TaskComment', ARRAY['taskId', 'createdAt'],
    $d$CREATE INDEX IF NOT EXISTS "TaskComment_taskId_createdAt_idx" ON "TaskComment"("taskId", "createdAt")$d$);
SELECT pg_temp.baseline_create_index('TaskComment', ARRAY['authorId'],
    $d$CREATE INDEX IF NOT EXISTS "TaskComment_authorId_idx" ON "TaskComment"("authorId")$d$);
SELECT pg_temp.baseline_create_index('Notification', ARRAY['userId', 'read'],
    $d$CREATE INDEX IF NOT EXISTS "Notification_userId_read_idx" ON "Notification"("userId", "read")$d$);
SELECT pg_temp.baseline_create_index('Notification', ARRAY['createdAt'],
    $d$CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx" ON "Notification"("createdAt")$d$);
SELECT pg_temp.baseline_create_index('ChannelMute', ARRAY['userId'],
    $d$CREATE INDEX IF NOT EXISTS "ChannelMute_userId_idx" ON "ChannelMute"("userId")$d$);
SELECT pg_temp.baseline_create_index('ChannelMute', ARRAY['userId', 'channelId'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "ChannelMute_userId_channelId_key" ON "ChannelMute"("userId", "channelId")$d$);
SELECT pg_temp.baseline_create_index('MessageRead', ARRAY['messageId'],
    $d$CREATE INDEX IF NOT EXISTS "MessageRead_messageId_idx" ON "MessageRead"("messageId")$d$);
SELECT pg_temp.baseline_create_index('MessageRead', ARRAY['userId', 'messageId'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "MessageRead_userId_messageId_key" ON "MessageRead"("userId", "messageId")$d$);
SELECT pg_temp.baseline_create_index('ScheduledMessage', ARRAY['scheduledAt', 'sent'],
    $d$CREATE INDEX IF NOT EXISTS "ScheduledMessage_scheduledAt_sent_idx" ON "ScheduledMessage"("scheduledAt", "sent")$d$);
SELECT pg_temp.baseline_create_index('ScheduledMessage', ARRAY['userId'],
    $d$CREATE INDEX IF NOT EXISTS "ScheduledMessage_userId_idx" ON "ScheduledMessage"("userId")$d$);
SELECT pg_temp.baseline_create_index('QAThread', ARRAY['channelId'],
    $d$CREATE INDEX IF NOT EXISTS "QAThread_channelId_idx" ON "QAThread"("channelId")$d$);
SELECT pg_temp.baseline_create_index('QAThread', ARRAY['authorId'],
    $d$CREATE INDEX IF NOT EXISTS "QAThread_authorId_idx" ON "QAThread"("authorId")$d$);
SELECT pg_temp.baseline_create_index('QAAnswer', ARRAY['threadId'],
    $d$CREATE INDEX IF NOT EXISTS "QAAnswer_threadId_idx" ON "QAAnswer"("threadId")$d$);
SELECT pg_temp.baseline_create_index('QAAnswer', ARRAY['authorId'],
    $d$CREATE INDEX IF NOT EXISTS "QAAnswer_authorId_idx" ON "QAAnswer"("authorId")$d$);
SELECT pg_temp.baseline_create_index('QAVote', ARRAY['threadId'],
    $d$CREATE INDEX IF NOT EXISTS "QAVote_threadId_idx" ON "QAVote"("threadId")$d$);
SELECT pg_temp.baseline_create_index('QAVote', ARRAY['answerId'],
    $d$CREATE INDEX IF NOT EXISTS "QAVote_answerId_idx" ON "QAVote"("answerId")$d$);
SELECT pg_temp.baseline_create_index('QAVote', ARRAY['userId', 'threadId'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "QAVote_userId_threadId_key" ON "QAVote"("userId", "threadId")$d$);
SELECT pg_temp.baseline_create_index('QAVote', ARRAY['userId', 'answerId'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "QAVote_userId_answerId_key" ON "QAVote"("userId", "answerId")$d$);
SELECT pg_temp.baseline_create_index('WikiArticle', ARRAY['channelId'],
    $d$CREATE INDEX IF NOT EXISTS "WikiArticle_channelId_idx" ON "WikiArticle"("channelId")$d$);
SELECT pg_temp.baseline_create_index('WikiArticle', ARRAY['collectionId'],
    $d$CREATE INDEX IF NOT EXISTS "WikiArticle_collectionId_idx" ON "WikiArticle"("collectionId")$d$);
SELECT pg_temp.baseline_create_index('WikiArticle', ARRAY['channelId', 'slug'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "WikiArticle_channelId_slug_key" ON "WikiArticle"("channelId", "slug")$d$);
SELECT pg_temp.baseline_create_index('WikiCollection', ARRAY['channelId'],
    $d$CREATE INDEX IF NOT EXISTS "WikiCollection_channelId_idx" ON "WikiCollection"("channelId")$d$);
SELECT pg_temp.baseline_create_index('WikiRevision', ARRAY['articleId'],
    $d$CREATE INDEX IF NOT EXISTS "WikiRevision_articleId_idx" ON "WikiRevision"("articleId")$d$);
SELECT pg_temp.baseline_create_index('CalendarEvent', ARRAY['channelId'],
    $d$CREATE INDEX IF NOT EXISTS "CalendarEvent_channelId_idx" ON "CalendarEvent"("channelId")$d$);
SELECT pg_temp.baseline_create_index('CalendarEvent', ARRAY['start'],
    $d$CREATE INDEX IF NOT EXISTS "CalendarEvent_start_idx" ON "CalendarEvent"("start")$d$);
SELECT pg_temp.baseline_create_index('WorkspaceFile', ARRAY['channelId'],
    $d$CREATE INDEX IF NOT EXISTS "WorkspaceFile_channelId_idx" ON "WorkspaceFile"("channelId")$d$);
SELECT pg_temp.baseline_create_index('Appeal', ARRAY['channelId'],
    $d$CREATE INDEX IF NOT EXISTS "Appeal_channelId_idx" ON "Appeal"("channelId")$d$);
SELECT pg_temp.baseline_create_index('Appeal', ARRAY['authorId'],
    $d$CREATE INDEX IF NOT EXISTS "Appeal_authorId_idx" ON "Appeal"("authorId")$d$);
SELECT pg_temp.baseline_create_index('Appeal', ARRAY['status'],
    $d$CREATE INDEX IF NOT EXISTS "Appeal_status_idx" ON "Appeal"("status")$d$);
SELECT pg_temp.baseline_create_index('AppealMessage', ARRAY['appealId'],
    $d$CREATE INDEX IF NOT EXISTS "AppealMessage_appealId_idx" ON "AppealMessage"("appealId")$d$);
SELECT pg_temp.baseline_create_index('AppealMessage', ARRAY['authorId'],
    $d$CREATE INDEX IF NOT EXISTS "AppealMessage_authorId_idx" ON "AppealMessage"("authorId")$d$);
SELECT pg_temp.baseline_create_index('GroupAuditEntry', ARRAY['groupId', 'createdAt'],
    $d$CREATE INDEX IF NOT EXISTS "GroupAuditEntry_groupId_createdAt_idx" ON "GroupAuditEntry"("groupId", "createdAt")$d$);
SELECT pg_temp.baseline_create_index('UserIdentity', ARRAY['kind', 'value'],
    $d$CREATE INDEX IF NOT EXISTS "UserIdentity_kind_value_idx" ON "UserIdentity"("kind", "value")$d$);
SELECT pg_temp.baseline_create_index('UserIdentity', ARRAY['userId', 'kind', 'value'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "UserIdentity_userId_kind_value_key" ON "UserIdentity"("userId", "kind", "value")$d$);
SELECT pg_temp.baseline_create_index('BlockedIdentity', ARRAY['userId'],
    $d$CREATE INDEX IF NOT EXISTS "BlockedIdentity_userId_idx" ON "BlockedIdentity"("userId")$d$);
SELECT pg_temp.baseline_create_index('BlockedIdentity', ARRAY['kind', 'value'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "BlockedIdentity_kind_value_key" ON "BlockedIdentity"("kind", "value")$d$);
SELECT pg_temp.baseline_create_index('PartnerProject', ARRAY['ownerId'],
    $d$CREATE INDEX IF NOT EXISTS "PartnerProject_ownerId_idx" ON "PartnerProject"("ownerId")$d$);
SELECT pg_temp.baseline_create_index('PartnerProject', ARRAY['status'],
    $d$CREATE INDEX IF NOT EXISTS "PartnerProject_status_idx" ON "PartnerProject"("status")$d$);
SELECT pg_temp.baseline_create_index('PartnerProjectMessage', ARRAY['projectId'],
    $d$CREATE INDEX IF NOT EXISTS "PartnerProjectMessage_projectId_idx" ON "PartnerProjectMessage"("projectId")$d$);
SELECT pg_temp.baseline_create_index('DmUserSetting', ARRAY['targetId'],
    $d$CREATE INDEX IF NOT EXISTS "DmUserSetting_targetId_idx" ON "DmUserSetting"("targetId")$d$);
SELECT pg_temp.baseline_create_index('DmUserSetting', ARRAY['ownerId', 'targetId'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "DmUserSetting_ownerId_targetId_key" ON "DmUserSetting"("ownerId", "targetId")$d$);
SELECT pg_temp.baseline_create_index('CalendarEventSubscription', ARRAY['userId'],
    $d$CREATE INDEX IF NOT EXISTS "CalendarEventSubscription_userId_idx" ON "CalendarEventSubscription"("userId")$d$);
SELECT pg_temp.baseline_create_index('CalendarEventSubscription', ARRAY['eventId', 'userId'],
    $d$CREATE UNIQUE INDEX IF NOT EXISTS "CalendarEventSubscription_eventId_userId_key" ON "CalendarEventSubscription"("eventId", "userId")$d$);

-- ════ 3. Внешние ключи ══════════════════════════════════════════════════════

SELECT pg_temp.baseline_add_fk('Group_ownerId_fkey', 'Group', ARRAY['ownerId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "Group" ADD CONSTRAINT "Group_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('GroupBan_groupId_fkey', 'GroupBan', ARRAY['groupId'], 'Group', ARRAY['id'],
    $d$ALTER TABLE "GroupBan" ADD CONSTRAINT "GroupBan_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('GroupBan_userId_fkey', 'GroupBan', ARRAY['userId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "GroupBan" ADD CONSTRAINT "GroupBan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('GroupBan_bannedById_fkey', 'GroupBan', ARRAY['bannedById'], 'User', ARRAY['id'],
    $d$ALTER TABLE "GroupBan" ADD CONSTRAINT "GroupBan_bannedById_fkey" FOREIGN KEY ("bannedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('GroupMember_userId_fkey', 'GroupMember', ARRAY['userId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('GroupMember_groupId_fkey', 'GroupMember', ARRAY['groupId'], 'Group', ARRAY['id'],
    $d$ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('Invite_groupId_fkey', 'Invite', ARRAY['groupId'], 'Group', ARRAY['id'],
    $d$ALTER TABLE "Invite" ADD CONSTRAINT "Invite_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('Invite_createdBy_fkey', 'Invite', ARRAY['createdBy'], 'User', ARRAY['id'],
    $d$ALTER TABLE "Invite" ADD CONSTRAINT "Invite_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('Channel_parentId_fkey', 'Channel', ARRAY['parentId'], 'Channel', ARRAY['id'],
    $d$ALTER TABLE "Channel" ADD CONSTRAINT "Channel_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('Channel_groupId_fkey', 'Channel', ARRAY['groupId'], 'Group', ARRAY['id'],
    $d$ALTER TABLE "Channel" ADD CONSTRAINT "Channel_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('ChannelMember_userId_fkey', 'ChannelMember', ARRAY['userId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "ChannelMember" ADD CONSTRAINT "ChannelMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('ChannelMember_channelId_fkey', 'ChannelMember', ARRAY['channelId'], 'Channel', ARRAY['id'],
    $d$ALTER TABLE "ChannelMember" ADD CONSTRAINT "ChannelMember_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('Message_replyToId_fkey', 'Message', ARRAY['replyToId'], 'Message', ARRAY['id'],
    $d$ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('Message_threadId_fkey', 'Message', ARRAY['threadId'], 'Message', ARRAY['id'],
    $d$ALTER TABLE "Message" ADD CONSTRAINT "Message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('Message_userId_fkey', 'Message', ARRAY['userId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "Message" ADD CONSTRAINT "Message_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('Message_channelId_fkey', 'Message', ARRAY['channelId'], 'Channel', ARRAY['id'],
    $d$ALTER TABLE "Message" ADD CONSTRAINT "Message_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('Reaction_userId_fkey', 'Reaction', ARRAY['userId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('Reaction_messageId_fkey', 'Reaction', ARRAY['messageId'], 'Message', ARRAY['id'],
    $d$ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('DirectConversation_user1Id_fkey', 'DirectConversation', ARRAY['user1Id'], 'User', ARRAY['id'],
    $d$ALTER TABLE "DirectConversation" ADD CONSTRAINT "DirectConversation_user1Id_fkey" FOREIGN KEY ("user1Id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('DirectConversation_user2Id_fkey', 'DirectConversation', ARRAY['user2Id'], 'User', ARRAY['id'],
    $d$ALTER TABLE "DirectConversation" ADD CONSTRAINT "DirectConversation_user2Id_fkey" FOREIGN KEY ("user2Id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('DirectMessage_replyToId_fkey', 'DirectMessage', ARRAY['replyToId'], 'DirectMessage', ARRAY['id'],
    $d$ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "DirectMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('DirectMessage_userId_fkey', 'DirectMessage', ARRAY['userId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('DirectMessage_conversationId_fkey', 'DirectMessage', ARRAY['conversationId'], 'DirectConversation', ARRAY['id'],
    $d$ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "DirectConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('UserBadge_userId_fkey', 'UserBadge', ARRAY['userId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('UserBadge_badgeId_fkey', 'UserBadge', ARRAY['badgeId'], 'Badge', ARRAY['id'],
    $d$ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('UserSession_userId_fkey', 'UserSession', ARRAY['userId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('GroupRole_groupId_fkey', 'GroupRole', ARRAY['groupId'], 'Group', ARRAY['id'],
    $d$ALTER TABLE "GroupRole" ADD CONSTRAINT "GroupRole_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('GroupMemberRole_memberId_fkey', 'GroupMemberRole', ARRAY['memberId'], 'GroupMember', ARRAY['id'],
    $d$ALTER TABLE "GroupMemberRole" ADD CONSTRAINT "GroupMemberRole_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "GroupMember"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('GroupMemberRole_roleId_fkey', 'GroupMemberRole', ARRAY['roleId'], 'GroupRole', ARRAY['id'],
    $d$ALTER TABLE "GroupMemberRole" ADD CONSTRAINT "GroupMemberRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "GroupRole"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('ChannelRoleAccess_channelId_fkey', 'ChannelRoleAccess', ARRAY['channelId'], 'Channel', ARRAY['id'],
    $d$ALTER TABLE "ChannelRoleAccess" ADD CONSTRAINT "ChannelRoleAccess_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('ChannelRoleAccess_roleId_fkey', 'ChannelRoleAccess', ARRAY['roleId'], 'GroupRole', ARRAY['id'],
    $d$ALTER TABLE "ChannelRoleAccess" ADD CONSTRAINT "ChannelRoleAccess_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "GroupRole"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('PremiumSubscription_userId_fkey', 'PremiumSubscription', ARRAY['userId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "PremiumSubscription" ADD CONSTRAINT "PremiumSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('PremiumSubscription_grantedById_fkey', 'PremiumSubscription', ARRAY['grantedById'], 'User', ARRAY['id'],
    $d$ALTER TABLE "PremiumSubscription" ADD CONSTRAINT "PremiumSubscription_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('AiChat_userId_fkey', 'AiChat', ARRAY['userId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "AiChat" ADD CONSTRAINT "AiChat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('Friendship_senderId_fkey', 'Friendship', ARRAY['senderId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('Friendship_receiverId_fkey', 'Friendship', ARRAY['receiverId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('GameRoom_hostId_fkey', 'GameRoom', ARRAY['hostId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "GameRoom" ADD CONSTRAINT "GameRoom_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('GamePlayer_roomId_fkey', 'GamePlayer', ARRAY['roomId'], 'GameRoom', ARRAY['id'],
    $d$ALTER TABLE "GamePlayer" ADD CONSTRAINT "GamePlayer_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "GameRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('GamePlayer_userId_fkey', 'GamePlayer', ARRAY['userId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "GamePlayer" ADD CONSTRAINT "GamePlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('GameInvite_roomId_fkey', 'GameInvite', ARRAY['roomId'], 'GameRoom', ARRAY['id'],
    $d$ALTER TABLE "GameInvite" ADD CONSTRAINT "GameInvite_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "GameRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('GameInvite_inviterId_fkey', 'GameInvite', ARRAY['inviterId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "GameInvite" ADD CONSTRAINT "GameInvite_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('GameInvite_inviteeId_fkey', 'GameInvite', ARRAY['inviteeId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "GameInvite" ADD CONSTRAINT "GameInvite_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('AiMessage_chatId_fkey', 'AiMessage', ARRAY['chatId'], 'AiChat', ARRAY['id'],
    $d$ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "AiChat"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('Poll_channelId_fkey', 'Poll', ARRAY['channelId'], 'Channel', ARRAY['id'],
    $d$ALTER TABLE "Poll" ADD CONSTRAINT "Poll_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('Poll_userId_fkey', 'Poll', ARRAY['userId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "Poll" ADD CONSTRAINT "Poll_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('PollOption_pollId_fkey', 'PollOption', ARRAY['pollId'], 'Poll', ARRAY['id'],
    $d$ALTER TABLE "PollOption" ADD CONSTRAINT "PollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('PollVote_optionId_fkey', 'PollVote', ARRAY['optionId'], 'PollOption', ARRAY['id'],
    $d$ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "PollOption"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('PollVote_userId_fkey', 'PollVote', ARRAY['userId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('ChannelTask_channelId_fkey', 'ChannelTask', ARRAY['channelId'], 'Channel', ARRAY['id'],
    $d$ALTER TABLE "ChannelTask" ADD CONSTRAINT "ChannelTask_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('ChannelTask_creatorId_fkey', 'ChannelTask', ARRAY['creatorId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "ChannelTask" ADD CONSTRAINT "ChannelTask_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('ChannelTask_assigneeId_fkey', 'ChannelTask', ARRAY['assigneeId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "ChannelTask" ADD CONSTRAINT "ChannelTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('ChannelTask_closedById_fkey', 'ChannelTask', ARRAY['closedById'], 'User', ARRAY['id'],
    $d$ALTER TABLE "ChannelTask" ADD CONSTRAINT "ChannelTask_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('ChannelTask_parentId_fkey', 'ChannelTask', ARRAY['parentId'], 'ChannelTask', ARRAY['id'],
    $d$ALTER TABLE "ChannelTask" ADD CONSTRAINT "ChannelTask_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ChannelTask"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('TaskChecklistItem_taskId_fkey', 'TaskChecklistItem', ARRAY['taskId'], 'ChannelTask', ARRAY['id'],
    $d$ALTER TABLE "TaskChecklistItem" ADD CONSTRAINT "TaskChecklistItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ChannelTask"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('TaskAttachment_taskId_fkey', 'TaskAttachment', ARRAY['taskId'], 'ChannelTask', ARRAY['id'],
    $d$ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ChannelTask"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('TaskAttachment_uploaderId_fkey', 'TaskAttachment', ARRAY['uploaderId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('TaskComment_taskId_fkey', 'TaskComment', ARRAY['taskId'], 'ChannelTask', ARRAY['id'],
    $d$ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ChannelTask"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('TaskComment_authorId_fkey', 'TaskComment', ARRAY['authorId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('Notification_userId_fkey', 'Notification', ARRAY['userId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('ChannelMute_userId_fkey', 'ChannelMute', ARRAY['userId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "ChannelMute" ADD CONSTRAINT "ChannelMute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('ChannelMute_channelId_fkey', 'ChannelMute', ARRAY['channelId'], 'Channel', ARRAY['id'],
    $d$ALTER TABLE "ChannelMute" ADD CONSTRAINT "ChannelMute_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('MessageRead_userId_fkey', 'MessageRead', ARRAY['userId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "MessageRead" ADD CONSTRAINT "MessageRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('MessageRead_messageId_fkey', 'MessageRead', ARRAY['messageId'], 'Message', ARRAY['id'],
    $d$ALTER TABLE "MessageRead" ADD CONSTRAINT "MessageRead_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('ScheduledMessage_userId_fkey', 'ScheduledMessage', ARRAY['userId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('ScheduledMessage_channelId_fkey', 'ScheduledMessage', ARRAY['channelId'], 'Channel', ARRAY['id'],
    $d$ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('QAThread_channelId_fkey', 'QAThread', ARRAY['channelId'], 'Channel', ARRAY['id'],
    $d$ALTER TABLE "QAThread" ADD CONSTRAINT "QAThread_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('QAThread_authorId_fkey', 'QAThread', ARRAY['authorId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "QAThread" ADD CONSTRAINT "QAThread_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('QAAnswer_threadId_fkey', 'QAAnswer', ARRAY['threadId'], 'QAThread', ARRAY['id'],
    $d$ALTER TABLE "QAAnswer" ADD CONSTRAINT "QAAnswer_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "QAThread"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('QAAnswer_authorId_fkey', 'QAAnswer', ARRAY['authorId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "QAAnswer" ADD CONSTRAINT "QAAnswer_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('QAVote_userId_fkey', 'QAVote', ARRAY['userId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "QAVote" ADD CONSTRAINT "QAVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('QAVote_threadId_fkey', 'QAVote', ARRAY['threadId'], 'QAThread', ARRAY['id'],
    $d$ALTER TABLE "QAVote" ADD CONSTRAINT "QAVote_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "QAThread"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('QAVote_answerId_fkey', 'QAVote', ARRAY['answerId'], 'QAAnswer', ARRAY['id'],
    $d$ALTER TABLE "QAVote" ADD CONSTRAINT "QAVote_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "QAAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('WikiArticle_channelId_fkey', 'WikiArticle', ARRAY['channelId'], 'Channel', ARRAY['id'],
    $d$ALTER TABLE "WikiArticle" ADD CONSTRAINT "WikiArticle_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('WikiArticle_collectionId_fkey', 'WikiArticle', ARRAY['collectionId'], 'WikiCollection', ARRAY['id'],
    $d$ALTER TABLE "WikiArticle" ADD CONSTRAINT "WikiArticle_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "WikiCollection"("id") ON DELETE SET NULL ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('WikiArticle_updatedById_fkey', 'WikiArticle', ARRAY['updatedById'], 'User', ARRAY['id'],
    $d$ALTER TABLE "WikiArticle" ADD CONSTRAINT "WikiArticle_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('WikiCollection_channelId_fkey', 'WikiCollection', ARRAY['channelId'], 'Channel', ARRAY['id'],
    $d$ALTER TABLE "WikiCollection" ADD CONSTRAINT "WikiCollection_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('WikiRevision_articleId_fkey', 'WikiRevision', ARRAY['articleId'], 'WikiArticle', ARRAY['id'],
    $d$ALTER TABLE "WikiRevision" ADD CONSTRAINT "WikiRevision_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "WikiArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('WikiRevision_editorId_fkey', 'WikiRevision', ARRAY['editorId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "WikiRevision" ADD CONSTRAINT "WikiRevision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('CalendarEvent_channelId_fkey', 'CalendarEvent', ARRAY['channelId'], 'Channel', ARRAY['id'],
    $d$ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('CalendarEvent_authorId_fkey', 'CalendarEvent', ARRAY['authorId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('WorkspaceFile_channelId_fkey', 'WorkspaceFile', ARRAY['channelId'], 'Channel', ARRAY['id'],
    $d$ALTER TABLE "WorkspaceFile" ADD CONSTRAINT "WorkspaceFile_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('WorkspaceFile_uploaderId_fkey', 'WorkspaceFile', ARRAY['uploaderId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "WorkspaceFile" ADD CONSTRAINT "WorkspaceFile_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('Appeal_channelId_fkey', 'Appeal', ARRAY['channelId'], 'Channel', ARRAY['id'],
    $d$ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('Appeal_authorId_fkey', 'Appeal', ARRAY['authorId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('AppealMessage_appealId_fkey', 'AppealMessage', ARRAY['appealId'], 'Appeal', ARRAY['id'],
    $d$ALTER TABLE "AppealMessage" ADD CONSTRAINT "AppealMessage_appealId_fkey" FOREIGN KEY ("appealId") REFERENCES "Appeal"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('AppealMessage_authorId_fkey', 'AppealMessage', ARRAY['authorId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "AppealMessage" ADD CONSTRAINT "AppealMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('WorkspaceState_userId_fkey', 'WorkspaceState', ARRAY['userId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "WorkspaceState" ADD CONSTRAINT "WorkspaceState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('ChannelWorkspaceState_channelId_fkey', 'ChannelWorkspaceState', ARRAY['channelId'], 'Channel', ARRAY['id'],
    $d$ALTER TABLE "ChannelWorkspaceState" ADD CONSTRAINT "ChannelWorkspaceState_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('GroupLayout_userId_fkey', 'GroupLayout', ARRAY['userId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "GroupLayout" ADD CONSTRAINT "GroupLayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('GroupAuditEntry_groupId_fkey', 'GroupAuditEntry', ARRAY['groupId'], 'Group', ARRAY['id'],
    $d$ALTER TABLE "GroupAuditEntry" ADD CONSTRAINT "GroupAuditEntry_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('UserIdentity_userId_fkey', 'UserIdentity', ARRAY['userId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "UserIdentity" ADD CONSTRAINT "UserIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('PartnerProject_ownerId_fkey', 'PartnerProject', ARRAY['ownerId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "PartnerProject" ADD CONSTRAINT "PartnerProject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('PartnerProjectMessage_projectId_fkey', 'PartnerProjectMessage', ARRAY['projectId'], 'PartnerProject', ARRAY['id'],
    $d$ALTER TABLE "PartnerProjectMessage" ADD CONSTRAINT "PartnerProjectMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PartnerProject"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('PartnerProjectMessage_authorId_fkey', 'PartnerProjectMessage', ARRAY['authorId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "PartnerProjectMessage" ADD CONSTRAINT "PartnerProjectMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('DmUserSetting_ownerId_fkey', 'DmUserSetting', ARRAY['ownerId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "DmUserSetting" ADD CONSTRAINT "DmUserSetting_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('DmUserSetting_targetId_fkey', 'DmUserSetting', ARRAY['targetId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "DmUserSetting" ADD CONSTRAINT "DmUserSetting_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('CalendarEventSubscription_eventId_fkey', 'CalendarEventSubscription', ARRAY['eventId'], 'CalendarEvent', ARRAY['id'],
    $d$ALTER TABLE "CalendarEventSubscription" ADD CONSTRAINT "CalendarEventSubscription_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);
SELECT pg_temp.baseline_add_fk('CalendarEventSubscription_userId_fkey', 'CalendarEventSubscription', ARRAY['userId'], 'User', ARRAY['id'],
    $d$ALTER TABLE "CalendarEventSubscription" ADD CONSTRAINT "CalendarEventSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE$d$);

-- ════ 4. Уборка ═════════════════════════════════════════════════════════════
--
-- Функции лежали в pg_temp — они и так исчезли бы вместе с соединением, но
-- снимаем их явно, чтобы после миграции в базе не осталось ничего лишнего.
DROP FUNCTION pg_temp.baseline_add_column(text, text, text, boolean, text);
DROP FUNCTION pg_temp.baseline_create_index(text, text[], text);
DROP FUNCTION pg_temp.baseline_add_fk(text, text, text[], text, text[], text);
