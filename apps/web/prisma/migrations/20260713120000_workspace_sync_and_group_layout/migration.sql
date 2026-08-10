-- Серверное состояние рабочей среды /workspace (синхронизация веб <-> десктоп)
-- CreateTable
CREATE TABLE "WorkspaceState" (
    "userId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceState_pkey" PRIMARY KEY ("userId")
);

-- Персональная раскладка списка сообществ: порядок и папки
-- CreateTable
CREATE TABLE "GroupLayout" (
    "userId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupLayout_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "WorkspaceState" ADD CONSTRAINT "WorkspaceState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupLayout" ADD CONSTRAINT "GroupLayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
