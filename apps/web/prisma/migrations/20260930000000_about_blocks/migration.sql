-- CreateTable
CREATE TABLE "AboutBlock" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "data" TEXT NOT NULL DEFAULT '{}',
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AboutBlock_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AboutBlock_position_idx" ON "AboutBlock"("position");
CREATE INDEX "AboutBlock_type_idx" ON "AboutBlock"("type");
