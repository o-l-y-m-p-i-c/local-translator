import { describe, expect, it } from "vitest";
import { groqMaxCompletionTokens } from "./groq.server";

describe("Groq request limits", () => {
  it("keeps gpt-oss completion requests below the 8K TPM limit", () => {
    const prompt = "Translate this Shopify section";
    const maxTokens = groqMaxCompletionTokens("openai/gpt-oss-120b", prompt);
    const estimatedInputTokens = Math.ceil((prompt.length + 110) / 3);

    expect(maxTokens).toBe(4096);
    expect(maxTokens + estimatedInputTokens).toBeLessThan(8000);
  });

  it("reduces completion tokens for larger prompts", () => {
    const shortPromptTokens = groqMaxCompletionTokens("openai/gpt-oss-120b", "short");
    const longPromptTokens = groqMaxCompletionTokens("openai/gpt-oss-120b", "x".repeat(12000));

    expect(longPromptTokens).toBeLessThan(shortPromptTokens);
    expect(longPromptTokens).toBeGreaterThanOrEqual(256);
  });

  it("uses a conservative limit for unknown models", () => {
    expect(groqMaxCompletionTokens("unknown-model", "short")).toBe(4096);
  });
});
