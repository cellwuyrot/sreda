-- Migration: replace old AboutBlock schema with new block-based schema
-- The table already exists (created in 20260831100000_about_blocks).
-- We drop the old columns and add the new ones.

-- Remove old columns
ALTER TABLE "AboutBlock" DROP COLUMN IF EXISTS "order";
ALTER TABLE "AboutBlock" DROP COLUMN IF EXISTS "title";
ALTER TABLE "AboutBlock" DROP COLUMN IF EXISTS "description";
ALTER TABLE "AboutBlock" DROP COLUMN IF EXISTS "mediaUrl";
ALTER TABLE "AboutBlock" DROP COLUMN IF EXISTS "mediaType";
ALTER TABLE "AboutBlock" DROP COLUMN IF EXISTS "layout";
ALTER TABLE "AboutBlock" DROP COLUMN IF EXISTS "textAlign";
ALTER TABLE "AboutBlock" DROP COLUMN IF EXISTS "glowColor";
ALTER TABLE "AboutBlock" DROP COLUMN IF EXISTS "shape";
ALTER TABLE "AboutBlock" DROP COLUMN IF EXISTS "spacingTop";
ALTER TABLE "AboutBlock" DROP COLUMN IF EXISTS "enabled";

-- Add new columns
ALTER TABLE "AboutBlock" ADD COLUMN IF NOT EXISTS "type"     TEXT    NOT NULL DEFAULT 'hero';
ALTER TABLE "AboutBlock" ADD COLUMN IF NOT EXISTS "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AboutBlock" ADD COLUMN IF NOT EXISTS "data"     TEXT    NOT NULL DEFAULT '{}';
ALTER TABLE "AboutBlock" ADD COLUMN IF NOT EXISTS "visible"  BOOLEAN NOT NULL DEFAULT true;

-- Recreate indexes
DROP INDEX IF EXISTS "AboutBlock_order_idx";
CREATE INDEX IF NOT EXISTS "AboutBlock_position_idx" ON "AboutBlock"("position");
CREATE INDEX IF NOT EXISTS "AboutBlock_type_idx" ON "AboutBlock"("type");
