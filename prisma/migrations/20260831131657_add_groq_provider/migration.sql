-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "encryptedGroqApiKey" TEXT,
ADD COLUMN     "groqModel" TEXT NOT NULL DEFAULT 'llama-3.3-70b-versatile';
