-- CreateTable
CREATE TABLE "WikiArticle" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WikiArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WikiRevision" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "editorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WikiRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WikiArticle_channelId_slug_key" ON "WikiArticle"("channelId", "slug");
CREATE INDEX "WikiArticle_channelId_idx" ON "WikiArticle"("channelId");
CREATE INDEX "WikiRevision_articleId_idx" ON "WikiRevision"("articleId");

-- AddForeignKey
ALTER TABLE "WikiArticle" ADD CONSTRAINT "WikiArticle_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WikiArticle" ADD CONSTRAINT "WikiArticle_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WikiRevision" ADD CONSTRAINT "WikiRevision_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "WikiArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WikiRevision" ADD CONSTRAINT "WikiRevision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
