-- Enable per-group sections (premium feature toggled by owner)
ALTER TABLE "Group" ADD COLUMN "sectionsEnabled" BOOLEAN NOT NULL DEFAULT false;
