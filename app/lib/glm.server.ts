/**
 * GLM (Z.ai / Zhipu AI) API client.
 * The Z.ai API is OpenAI-compatible: https://api.z.ai/api/paas/v4/chat/completions
 * Free models: glm-4.5-flash, glm-4.7-flash
 * Paid models: glm-5.2, glm-4.5, glm-4.5-air, etc.
 */

import { validatePlaceholders } from "./locale";
import { localeDisplayName, promptFor, type TranslationItem, type TranslationContext, type GeminiUsage } from "./gemini.server";

const GLM_API_URL = "https://api.z.ai/api/paas/v4/chat/completions";
const GLM_API_URL_CN = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

export class GlmApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GlmApiError";
    this.status = status;
  }
}

export function isRetryableGlmError(error: unknown) {
  if (error instanceof GlmApiError && (error.status === 429 || error.status >= 500)) return true;
  if (error instanceof TypeError && error.message.includes("fetch failed")) return true;
  if (error instanceof Error && error.message.includes("GLM API timeout")) return true;
  return false;
}

/**
 * Translate a batch of strings using GLM (Z.ai) API.
 * OpenAI-compatible chat completions endpoint.
 */
export async function translateBatchGlm(
  items: TranslationItem[],
  sourceLocale: string,
  targetLocale: string,
  apiKey: string,
  model: string,
  context?: TranslationContext,
): Promise<{ translations: Record<string, string>; usage: GeminiUsage }> {
  if (!items.length) {
    return {
      translations: {},
      usage: { promptTokenCount: 0, candidatesTokenCount: 0, thoughtsTokenCount: 0, totalTokenCount: 0 },
    };
  }

  const prompt = promptFor(items, sourceLocale, targetLocale, context);

  const body = {
    model,
    messages: [
      {
        role: "system",
        content: "You are a professional translator for a Shopify e-commerce store. You must return valid JSON only, no markdown, no explanation. The response must be a JSON object with a 'translations' array, where each element has 'key' and 'translation' string fields.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
    max_tokens: 16384,
  };

  const response = await Promise.race([
    fetch(GLM_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("GLM API timeout after 120s")), 120_000),
    ),
  ]);

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new GlmApiError(`GLM API error ${response.status}: ${errorText}`, response.status);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("GLM returned an empty response");

  // Parse the JSON response — GLM with response_format json_object should return clean JSON
  let parsed: { translations?: Array<{ key?: unknown; translation?: unknown }> };
  try {
    parsed = JSON.parse(content);
  } catch {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[1]);
    } else {
      throw new Error(`GLM returned non-JSON response: ${content.slice(0, 200)}`);
    }
  }

  const requested = new Map(items.map((item) => [item.key, item.source]));
  const translations: Record<string, string> = {};

  for (const result of parsed.translations ?? []) {
    if (typeof result.key !== "string" || typeof result.translation !== "string") continue;
    const source = requested.get(result.key);
    if (source === undefined || result.key in translations) continue;
    const invalid = validatePlaceholders(source, result.translation);
    if (invalid.length) {
      console.log(`[translateBatchGlm] Skipping key "${result.key}" — GLM changed protected tokens: ${invalid.join(", ")}`);
      translations[result.key] = source;
      continue;
    }
    translations[result.key] = result.translation;
  }

  const missing = items.filter(({ key }) => !(key in translations));
  if (missing.length) {
    console.log(`[translateBatchGlm] GLM omitted ${missing.length} translation(s), returning partial results`);
  }

  // Post-translation check: detect unchanged strings and retry with force mode
  if (!context?.force) {
    const untranslated = items.filter(({ key, source }) =>
      translations[key] === source && source.trim().length > 0
    );
    if (untranslated.length) {
      console.log(`[translateBatchGlm] ${untranslated.length} string(s) returned unchanged, retrying with force mode...`);
      const retryContext = { ...context, force: true };
      const retryResult = await translateBatchGlm(untranslated, sourceLocale, targetLocale, apiKey, model, retryContext);
      for (const { key } of untranslated) {
        const retried = retryResult.translations[key];
        if (retried && retried !== translations[key]) {
          translations[key] = retried;
        }
      }
    }
  }

  return {
    translations,
    usage: {
      promptTokenCount: data.usage?.prompt_tokens ?? 0,
      candidatesTokenCount: data.usage?.completion_tokens ?? 0,
      thoughtsTokenCount: 0,
      totalTokenCount: data.usage?.total_tokens ?? 0,
    },
  };
}
