-- NEW: пауза группы («скелетирование») — контент виден только владельцу и админам
ALTER TABLE "Group" ADD COLUMN "paused" BOOLEAN NOT NULL DEFAULT false;
