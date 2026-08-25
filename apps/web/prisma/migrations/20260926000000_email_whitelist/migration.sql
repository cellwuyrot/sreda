-- MAIL-WHITELIST: белый список почтовых доменов для регистрации.
CREATE TABLE IF NOT EXISTS "EmailDomainWhitelist" (
    "id" TEXT NOT NULL,
    "domain" VARCHAR(100) NOT NULL,
    "note" VARCHAR(80) NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailDomainWhitelist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EmailDomainWhitelist_domain_key" ON "EmailDomainWhitelist"("domain");
CREATE INDEX IF NOT EXISTS "EmailDomainWhitelist_active_idx" ON "EmailDomainWhitelist"("active");

-- Начальный набор: мировые почты и российские службы. Без строк в таблице
-- ограничение оставалось бы без смысла: либо не пускало бы никого, либо всех.
INSERT INTO "EmailDomainWhitelist" ("id", "domain", "note")
VALUES
    ('wl_gmail',        'gmail.com',      'Google'),
    ('wl_googlemail',   'googlemail.com', 'Google'),
    ('wl_icloud',       'icloud.com',     'Apple'),
    ('wl_me',           'me.com',         'Apple'),
    ('wl_outlook',      'outlook.com',    'Microsoft'),
    ('wl_hotmail',      'hotmail.com',    'Microsoft'),
    ('wl_live',         'live.com',       'Microsoft'),
    ('wl_yahoo',        'yahoo.com',      'Yahoo'),
    ('wl_protonme',     'proton.me',      'Proton'),
    ('wl_protonmail',   'protonmail.com', 'Proton'),
    ('wl_yandexru',     'yandex.ru',      'Яндекс'),
    ('wl_yaru',         'ya.ru',          'Яндекс'),
    ('wl_yandexcom',    'yandex.com',     'Яндекс'),
    ('wl_mailru',       'mail.ru',        'Mail.ru'),
    ('wl_inbox',        'inbox.ru',       'Mail.ru'),
    ('wl_bk',           'bk.ru',          'Mail.ru'),
    ('wl_list',         'list.ru',        'Mail.ru'),
    ('wl_internet',     'internet.ru',    'Mail.ru'),
    ('wl_vk',           'vk.com',         'VK'),
    ('wl_rambler',      'rambler.ru',     'Рамблер'),
    ('wl_lenta',        'lenta.ru',       'Рамблер'),
    ('wl_autorambler',  'autorambler.ru', 'Рамблер'),
    ('wl_roru',         'ro.ru',          'Рамблер'),
    ('wl_trioz',        'trioz.ru',       'Свой домен')
ON CONFLICT ("domain") DO NOTHING;
