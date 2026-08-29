-- AlterTable
ALTER TABLE "ContentTranslationJob" ADD COLUMN     "currentResourceCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "currentResourceType" TEXT,
ADD COLUMN     "totalResourceCount" INTEGER NOT NULL DEFAULT 0;
