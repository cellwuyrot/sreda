-- GROUP-SKIN: оформление сообщества хранится одним JSON-полем.
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS "theme" TEXT NOT NULL DEFAULT '';
