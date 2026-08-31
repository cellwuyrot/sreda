-- CreateTable
CREATE TABLE IF NOT EXISTS "AboutBlock" (
    "id"          TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "order"       INTEGER NOT NULL DEFAULT 0,
    "title"       TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "mediaUrl"    TEXT,
    "mediaType"   TEXT NOT NULL DEFAULT 'image',
    "layout"      TEXT NOT NULL DEFAULT 'text-left',
    "textAlign"   TEXT NOT NULL DEFAULT 'left',
    "glowColor"   TEXT NOT NULL DEFAULT '#8b5cf6',
    "shape"       TEXT NOT NULL DEFAULT 'rectangle',
    "spacingTop"  INTEGER NOT NULL DEFAULT 60,
    "enabled"     BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AboutBlock_order_idx" ON "AboutBlock" ("order");
