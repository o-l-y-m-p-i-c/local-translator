/**
 * Groq API client.
 * Groq is OpenAI-compatible: https://api.groq.com/openai/v1/chat/completions
 * Free tier — no credit card required.
 *
 * Models & free tier limits (per organization):
 *   llama-3.1-8b-instant:        30 RPM,  6K TPM,  14,400 RPD
 *   llama-3.3-70b-versatile:     30 RPM, 12K TPM,   1,000 RPD
 *   llama-4-scout-17b-16e:       30 RPM, 30K TPM,   1,000 RPD
 *   qwen/qwen3-32b:              60 RPM,  6K TPM,   1,000 RPD
 *   openai/gpt-oss-120b:         30 RPM,  8K TPM,   1,000 RPD
 *
 * Groq is very fast (500-3,000 tokens/sec) — no timeout issues like GLM.
 * Uses streaming for consistency, though non-streaming would also work fine.
 */

import { validatePlaceholders } from "./locale";
import { localeDisplayName, promptForCompact, type TranslationItem, type TranslationContext, type GeminiUsage } from "./gemini.server";

const GROQ_API_URLS = [
  "https://api.groq.com/openai/v1/chat/completions",
];

const GROQ_SYSTEM_PROMPT = "Translate for a Shopify store. Return JSON only: {\"translations\":[{\"key\":\"...\",\"translation\":\"...\"}]}";

const GROQ_MODEL_TPM: Record<string, number> = {
  "llama-3.1-8b-instant": 6000,
  "llama-3.3-70b-versatile": 12000,
  "meta-llama/llama-4-scout-17b-16e-instruct": 30000,
  "qwen/qwen3-32b": 6000,
  "openai/gpt-oss-20b": 8000,
  "openai/gpt-oss-120b": 8000,
};

export function groqMaxCompletionTokens(model: string, prompt: string) {
  const requestBudget = Math.floor((GROQ_MODEL_TPM[model] ?? 6000) * 0.9);
  const estimatedInputTokens = Math.ceil((GROQ_SYSTEM_PROMPT.length + prompt.length) / 3);
  return Math.max(256, Math.min(4096, requestBudget - estimatedInputTokens));
}

export class GroqApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GroqApiError";
    this.status = status;
  }
}

export function isRetryableGroqError(error: unknown) {
  // 429 = RPM rate limit (retry after waiting), 500+ = server errors
  // 413 = TPM exceeded — NOT retryable, the batch must be split (retrying same size always fails)
  if (error instanceof GroqApiError && (error.status === 429 || error.status >= 500)) return true;
  if (error instanceof TypeError && error.message.includes("fetch failed")) return true;
  if (error instanceof Error && error.message.includes("Groq API timeout")) return true;
  if (error instanceof Error && error.message.includes("aborted")) return true;
  if (error instanceof Error && error.message.includes("network")) return true;
  return false;
}

/**
 * Retry with exponential backoff for Groq errors.
 * Groq free tier: 30 RPM for most models. Rate limits are per-organization.
 * Waits: 5s, 10s, 20s, 40s between attempts.
 */
async function withGroqRetry<T>(fn: () => Promise<T>, maxRetries = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries || !isRetryableGroqError(error)) throw error;
      // 413 = TPM exceeded (per-minute token limit) — wait 60s for the window to reset
      // 429 = RPM exceeded — wait 60s for the window to reset
      // 500+ = server error — shorter backoff
      const isTpmError = error instanceof GroqApiError && (error.status === 413 || error.status === 429);
      const delay = isTpmError ? 60000 : Math.min(5000 * Math.pow(2, attempt), 60000);
      const errorDetail = error instanceof GroqApiError ? `status ${error.status}` : error instanceof Error ? error.message : String(error);
      console.log(`[translateBatchGroq] Retryable error (${errorDetail}), waiting ${delay / 1000}s before retry ${attempt + 1}/${maxRetries}...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// ─── Rate limiter for Groq free tier ────────────────────────────────────────
// Free tier: 30 RPM (1 request per 2s) for most models.
// We use 2.1s between requests to stay safely under 30 RPM.
let lastGroqRequestTime = 0;
const GROQ_MIN_INTERVAL_MS = 2100; // ~28 RPM, safe margin

async function enforceGroqRateLimit() {
  const now = Date.now();
  const elapsed = now - lastGroqRequestTime;
  if (elapsed < GROQ_MIN_INTERVAL_MS) {
    const waitMs = GROQ_MIN_INTERVAL_MS - elapsed;
    console.log(`[groqRateLimit] Waiting ${waitMs}ms to stay within free tier (30 RPM)...`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastGroqRequestTime = Date.now();
}

/**
 * Translate a batch of strings using Groq API.
 * OpenAI-compatible chat completions endpoint.
 * Auto-splits on 413 (TPM exceeded) to handle large content.
 */
export async function translateBatchGroq(
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

  // If the batch is large, try it first — but if we get a 413 (TPM exceeded),
  // split it in half and recurse. This handles cases where individual items
  // have very long content (e.g. HTML in section groups).
  if (items.length > 1) {
    try {
      return await translateBatchGroqSingle(items, sourceLocale, targetLocale, apiKey, model, context);
    } catch (error) {
      if (error instanceof GroqApiError && error.status === 413) {
        console.log(`[translateBatchGroq] 413 TPM exceeded with ${items.length} items, splitting in half and retrying...`);
        const mid = Math.ceil(items.length / 2);
        const left = await translateBatchGroq(items.slice(0, mid), sourceLocale, targetLocale, apiKey, model, context);
        const right = await translateBatchGroq(items.slice(mid), sourceLocale, targetLocale, apiKey, model, context);
        return {
          translations: { ...left.translations, ...right.translations },
          usage: {
            promptTokenCount: left.usage.promptTokenCount + right.usage.promptTokenCount,
            candidatesTokenCount: left.usage.candidatesTokenCount + right.usage.candidatesTokenCount,
            thoughtsTokenCount: left.usage.thoughtsTokenCount + right.usage.thoughtsTokenCount,
            totalTokenCount: left.usage.totalTokenCount + right.usage.totalTokenCount,
          },
        };
      }
      throw error;
    }
  }

  try {
    return await translateBatchGroqSingle(items, sourceLocale, targetLocale, apiKey, model, context);
  } catch (error) {
    if (error instanceof GroqApiError && error.status === 413) {
      console.log(`[translateBatchGroq] Single item exceeds the current TPM window (${items[0]?.source.length} chars), waiting 60s...`);
      await new Promise((resolve) => setTimeout(resolve, 60000));
      return translateBatchGroqSingle(items, sourceLocale, targetLocale, apiKey, model, context);
    }
    throw error;
  }
}

/**
 * Internal: single attempt to translate a batch via Groq API (no auto-split).
 */
async function translateBatchGroqSingle(
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

  // Use compact prompt to save ~400 tokens per request (Groq has low TPM limits)
  const prompt = promptForCompact(items, sourceLocale, targetLocale, context);

  const body = {
    model,
    messages: [
      {
        role: "system",
        content: GROQ_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
    max_tokens: groqMaxCompletionTokens(model, prompt),
    stream: true,
  };

  let lastError: unknown;
  for (const apiUrl of GROQ_API_URLS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120_000);

      const response = await withGroqRetry(async () => {
        await enforceGroqRateLimit();
        return fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new GroqApiError(`Groq API error ${response.status}: ${errorText}`, response.status);
      }

      // Read streaming response
      let fullContent = "";
      let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } = {};

      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") continue;

            try {
              const chunk = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>;
                usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
              };
              const delta = chunk.choices?.[0]?.delta?.content;
              if (delta) fullContent += delta;
              if (chunk.usage) usage = chunk.usage;
            } catch {
              // ignore parse errors on partial chunks
            }
          }
        }
      } else {
        const data = await response.json() as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };
        fullContent = data.choices?.[0]?.message?.content || "";
        usage = data.usage || {};
      }

      if (!fullContent) throw new Error("Groq returned an empty response");

      // Parse the accumulated JSON content
      let parsed: { translations?: Array<{ key?: unknown; translation?: unknown }> };
      try {
        parsed = JSON.parse(fullContent);
      } catch {
        const jsonMatch = fullContent.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1]);
        } else {
          throw new Error(`Groq returned non-JSON response: ${fullContent.slice(0, 200)}`);
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
          console.log(`[translateBatchGroq] Skipping key "${result.key}" — Groq changed protected tokens: ${invalid.join(", ")}`);
          translations[result.key] = source;
          continue;
        }
        translations[result.key] = result.translation;
      }

      const missing = items.filter(({ key }) => !(key in translations));
      if (missing.length) {
        console.log(`[translateBatchGroq] Groq omitted ${missing.length} translation(s), returning partial results`);
      }

      // Post-translation check: detect unchanged strings and retry with force mode
      if (!context?.force) {
        const untranslated = items.filter(({ key, source }) =>
          translations[key] === source && source.trim().length > 0
        );
        if (untranslated.length) {
          console.log(`[translateBatchGroq] ${untranslated.length} string(s) returned unchanged, retrying with force mode...`);
          const retryContext = { ...context, force: true };
          const retryResult = await translateBatchGroq(untranslated, sourceLocale, targetLocale, apiKey, model, retryContext);
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
          promptTokenCount: usage.prompt_tokens ?? 0,
          candidatesTokenCount: usage.completion_tokens ?? 0,
          thoughtsTokenCount: 0,
          totalTokenCount: usage.total_tokens ?? 0,
        },
      };
    } catch (error) {
      lastError = error;
      console.log(`[translateBatchGroq] Endpoint ${apiUrl} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw lastError || new Error("All Groq API endpoints failed");
}
