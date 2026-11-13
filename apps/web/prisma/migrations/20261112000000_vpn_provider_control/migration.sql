-- VPN-PROVIDER: глобальный активный провайдер сервиса.
-- Существующие пользователи, подписки и счётчики остаются без изменений.
-- Значение по умолчанию намеренно сохраняет текущий AmneziaWG data plane.

ALTER TABLE "VpnSettings"
  ADD COLUMN IF NOT EXISTS "activeProvider" TEXT NOT NULL DEFAULT 'AMNEZIAWG';

UPDATE "VpnSettings"
SET "activeProvider" = 'AMNEZIAWG'
WHERE "activeProvider" IS NULL OR "activeProvider" = '';
