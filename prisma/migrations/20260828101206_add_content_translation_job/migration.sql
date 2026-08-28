-- CreateTable
CREATE TABLE "ContentTranslationJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "targetLocale" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "completedItems" INTEGER NOT NULL DEFAULT 0,
    "failedItems" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ContentTranslationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentTranslationJob_shop_status_idx" ON "ContentTranslationJob"("shop", "status");

-- CreateIndex
CREATE INDEX "ContentTranslationJob_shop_targetLocale_idx" ON "ContentTranslationJob"("shop", "targetLocale");

-- RenameIndex
ALTER INDEX "TranslationWorkspace_shop_themeId_sourceFilename_targetLocale_k" RENAME TO "TranslationWorkspace_shop_themeId_sourceFilename_targetLoca_key";
