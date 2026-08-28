-- CreateTable
CREATE TABLE "TranslationVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "targetSnapshot" TEXT NOT NULL,
    "statusSnapshot" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranslationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TranslationVersion_workspaceId_createdAt_idx" ON "TranslationVersion"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "TranslationVersion" ADD CONSTRAINT "TranslationVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "TranslationWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
