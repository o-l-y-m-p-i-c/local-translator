import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import prisma from "../db.server";
import { parseGeminiModel } from "./gemini-settings";

function encryptionKey() {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error("SHOPIFY_API_SECRET is not configured");
  return createHash("sha256").update("shopify-locale-translator:gemini-key:v1").update(secret).digest();
}

export function encryptGeminiApiKey(apiKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptGeminiApiKey(payload: string) {
  const [version, iv, tag, ciphertext] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Stored Gemini API key is invalid");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export async function getShopGeminiConfiguration(shop: string) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings?.encryptedGeminiApiKey) return null;
  return {
    apiKey: decryptGeminiApiKey(settings.encryptedGeminiApiKey),
    model: parseGeminiModel(settings.geminiModel),
    batchSize: settings.batchSize,
    lazyLoadPageSize: settings.lazyLoadPageSize ?? 20,
    brandName: settings.brandName ?? null,
  };
}
