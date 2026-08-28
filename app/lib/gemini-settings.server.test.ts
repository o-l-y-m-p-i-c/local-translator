import { afterEach, describe, expect, it } from "vitest";
import { parseBatchSize, parseGeminiModel } from "./gemini-settings";
import {
  decryptGeminiApiKey,
  encryptGeminiApiKey,
} from "./gemini-settings.server";

const originalSecret = process.env.SHOPIFY_API_SECRET;

afterEach(() => {
  process.env.SHOPIFY_API_SECRET = originalSecret;
});

describe("Gemini shop settings", () => {
  it("encrypts API keys with authenticated encryption", () => {
    process.env.SHOPIFY_API_SECRET = "test-shopify-secret";
    const encrypted = encryptGeminiApiKey("private-gemini-key");
    expect(encrypted).not.toContain("private-gemini-key");
    expect(decryptGeminiApiKey(encrypted)).toBe("private-gemini-key");
  });

  it("rejects tampered encrypted API keys", () => {
    process.env.SHOPIFY_API_SECRET = "test-shopify-secret";
    const encrypted = encryptGeminiApiKey("private-gemini-key");
    expect(() => decryptGeminiApiKey(`${encrypted.slice(0, -2)}AA`)).toThrow();
  });

  it("accepts any non-empty model name and bounded batch sizes", () => {
    expect(parseGeminiModel("gemini-2.5-flash-lite")).toBe("gemini-2.5-flash-lite");
    expect(parseGeminiModel("gemini-pro-unsafe")).toBe("gemini-pro-unsafe");
    expect(() => parseGeminiModel("")).toThrow();
    expect(() => parseGeminiModel("   ")).toThrow();
    expect(parseBatchSize("30")).toBe(30);
    expect(() => parseBatchSize("0")).toThrow();
    expect(() => parseBatchSize("51")).toThrow();
  });
});
