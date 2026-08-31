-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "aiProvider" TEXT NOT NULL DEFAULT 'gemini',
ADD COLUMN     "encryptedGlmApiKey" TEXT,
ADD COLUMN     "glmModel" TEXT NOT NULL DEFAULT 'glm-4.5-flash',
ALTER COLUMN "geminiModel" SET DEFAULT 'gemini-3.5-flash';
