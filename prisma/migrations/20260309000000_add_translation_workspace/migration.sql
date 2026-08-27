CREATE TABLE "TranslationWorkspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "themeName" TEXT NOT NULL,
    "sourceFilename" TEXT NOT NULL,
    "sourceLocale" TEXT NOT NULL,
    "targetLocale" TEXT NOT NULL,
    "sourceSnapshot" TEXT NOT NULL,
    "targetSnapshot" TEXT NOT NULL,
    "statusSnapshot" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "TranslationWorkspace_shop_themeId_sourceFilename_targetLocale_key" ON "TranslationWorkspace"("shop", "themeId", "sourceFilename", "targetLocale");
CREATE INDEX "TranslationWorkspace_shop_themeId_idx" ON "TranslationWorkspace"("shop", "themeId");
