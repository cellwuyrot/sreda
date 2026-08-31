-- CreateTable
CREATE TABLE IF NOT EXISTS "AboutBlock" (
    "id"          TEXT NOT NULL PRIMARY KEY,
    "order"       INTEGER NOT NULL DEFAULT 0,
    "title"       VARCHAR(300) NOT NULL,
    "description" TEXT NOT NULL,
    "mediaUrl"    VARCHAR(500),
    "mediaType"   TEXT NOT NULL DEFAULT 'image',
    "layout"      TEXT NOT NULL DEFAULT 'text-left',
    "textAlign"   TEXT NOT NULL DEFAULT 'left',
    "glowColor"   TEXT NOT NULL DEFAULT '#8b5cf6',
    "shape"       TEXT NOT NULL DEFAULT 'rectangle',
    "spacingTop"  INTEGER NOT NULL DEFAULT 60,
    "enabled"     BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AboutBlock_order_idx" ON "AboutBlock"("order");
