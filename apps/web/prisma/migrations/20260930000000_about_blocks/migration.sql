-- Migration: трансформировать AboutBlock из старой схемы в новую.
-- Таблица уже существует с 20260831100000_about_blocks (поля order, title,
-- description, mediaUrl, mediaType, layout, textAlign, glowColor, shape,
-- spacingTop, enabled). Удаляем старые поля, добавляем новые (type, position,
-- data, visible). Использование IF EXISTS / IF NOT EXISTS делает миграцию
-- безопасной как для свежей БД, так и для существующей.

ALTER TABLE "AboutBlock"
  DROP COLUMN IF EXISTS "order",
  DROP COLUMN IF EXISTS "title",
  DROP COLUMN IF EXISTS "description",
  DROP COLUMN IF EXISTS "mediaUrl",
  DROP COLUMN IF EXISTS "mediaType",
  DROP COLUMN IF EXISTS "layout",
  DROP COLUMN IF EXISTS "textAlign",
  DROP COLUMN IF EXISTS "glowColor",
  DROP COLUMN IF EXISTS "shape",
  DROP COLUMN IF EXISTS "spacingTop",
  DROP COLUMN IF EXISTS "enabled",
  ADD COLUMN IF NOT EXISTS "type"     TEXT    NOT NULL DEFAULT 'hero',
  ADD COLUMN IF NOT EXISTS "position" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "data"     TEXT    NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "visible"  BOOLEAN NOT NULL DEFAULT true;

DROP INDEX IF EXISTS "AboutBlock_order_idx";
CREATE INDEX IF NOT EXISTS "AboutBlock_position_idx" ON "AboutBlock"("position");
CREATE INDEX IF NOT EXISTS "AboutBlock_type_idx"     ON "AboutBlock"("type");
