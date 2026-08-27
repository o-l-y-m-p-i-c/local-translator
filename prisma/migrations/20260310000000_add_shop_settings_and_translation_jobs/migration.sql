CREATE TABLE "ShopSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "encryptedGeminiApiKey" TEXT,
    "geminiModel" TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
    "batchSize" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "TranslationJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "activeKey" TEXT,
    "pendingKeys" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalItems" INTEGER NOT NULL,
    "completedItems" INTEGER NOT NULL DEFAULT 0,
    "promptTokenCount" INTEGER NOT NULL DEFAULT 0,
    "candidatesTokenCount" INTEGER NOT NULL DEFAULT 0,
    "thoughtsTokenCount" INTEGER NOT NULL DEFAULT 0,
    "totalTokenCount" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT NOT NULL,
    "error" TEXT,
    "processingStartedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "TranslationJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "TranslationWorkspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TranslationJob_activeKey_key" ON "TranslationJob"("activeKey");
CREATE INDEX "TranslationJob_workspaceId_status_idx" ON "TranslationJob"("workspaceId", "status");
