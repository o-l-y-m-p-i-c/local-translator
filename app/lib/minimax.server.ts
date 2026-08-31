/**
 * MiniMax API client.
 * MiniMax is OpenAI-compatible: https://api.minimax.io/v1/chat/completions
 * Models: MiniMax-M3 (1M context), MiniMax-M2.7, MiniMax-M2.5, etc.
 *
 * Paid API (no free tier for text models) — user must top up balance.
 * Rate limits (paid): 200–500 RPM, 10M–20M TPM.
 * Uses streaming mode for consistency with GLM client.
 */

import { validatePlaceholders } from "./locale";
import { localeDisplayName, promptFor, type TranslationItem, type TranslationContext, type GeminiUsage } from "./gemini.server";

const MINIMAX_API_URLS = [
  "https://api.minimax.io/v1/chat/completions",
];

export class MinimaxApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "MinimaxApiError";
    this.status = status;
  }
}

export function isRetryableMinimaxError(error: unknown) {
  if (error instanceof MinimaxApiError && (error.status === 429 || error.status >= 500)) return true;
  if (error instanceof TypeError && error.message.includes("fetch failed")) return true;
  if (error instanceof Error && error.message.includes("MiniMax API timeout")) return true;
  if (error instanceof Error && error.message.includes("aborted")) return true;
  if (error instanceof Error && error.message.includes("network")) return true;
  return false;
}

/**
 * Retry with exponential backoff for MiniMax errors.
 * Waits: 5s, 10s, 20s, 40s between attempts.
 */
async function withMinimaxRetry<T>(fn: () => Promise<T>, maxRetries = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries || !isRetryableMinimaxError(error)) throw error;
      const delay = Math.min(5000 * Math.pow(2, attempt), 60000);
      const errorDetail = error instanceof MinimaxApiError ? `status ${error.status}` : error instanceof Error ? error.message : String(error);
      console.log(`[translateBatchMinimax] Retryable error (${errorDetail}), waiting ${delay / 1000}s before retry ${attempt + 1}/${maxRetries}...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * Translate a batch of strings using MiniMax API.
 * OpenAI-compatible chat completions endpoint.
 */
export async function translateBatchMinimax(
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

  const body: Record<string, unknown> = {
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
    stream: true,
  };

  // MiniMax M3 supports "thinking" — disable for translation to reduce token usage
  if (model.toLowerCase().includes("m3")) {
    body.thinking = { type: "disabled" };
  }

  // Try each API endpoint until one works
  let lastError: unknown;
  for (const apiUrl of MINIMAX_API_URLS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180_000);

      const response = await withMinimaxRetry(() => fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }));

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new MinimaxApiError(`MiniMax API error ${response.status}: ${errorText}`, response.status);
      }

      // Read streaming response — accumulate chunks until done
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

      if (!fullContent) throw new Error("MiniMax returned an empty response");

      // Parse the accumulated JSON content
      let parsed: { translations?: Array<{ key?: unknown; translation?: unknown }> };
      try {
        parsed = JSON.parse(fullContent);
      } catch {
        const jsonMatch = fullContent.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1]);
        } else {
          throw new Error(`MiniMax returned non-JSON response: ${fullContent.slice(0, 200)}`);
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
          console.log(`[translateBatchMinimax] Skipping key "${result.key}" — MiniMax changed protected tokens: ${invalid.join(", ")}`);
          translations[result.key] = source;
          continue;
        }
        translations[result.key] = result.translation;
      }

      const missing = items.filter(({ key }) => !(key in translations));
      if (missing.length) {
        console.log(`[translateBatchMinimax] MiniMax omitted ${missing.length} translation(s), returning partial results`);
      }

      // Post-translation check: detect unchanged strings and retry with force mode
      if (!context?.force) {
        const untranslated = items.filter(({ key, source }) =>
          translations[key] === source && source.trim().length > 0
        );
        if (untranslated.length) {
          console.log(`[translateBatchMinimax] ${untranslated.length} string(s) returned unchanged, retrying with force mode...`);
          const retryContext = { ...context, force: true };
          const retryResult = await translateBatchMinimax(untranslated, sourceLocale, targetLocale, apiKey, model, retryContext);
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
      console.log(`[translateBatchMinimax] Endpoint ${apiUrl} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw lastError || new Error("All MiniMax API endpoints failed");
}
