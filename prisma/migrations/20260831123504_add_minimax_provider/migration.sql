-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "encryptedMinimaxApiKey" TEXT,
ADD COLUMN     "minimaxModel" TEXT NOT NULL DEFAULT 'MiniMax-M3';
