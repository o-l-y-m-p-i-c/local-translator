import { ApiError, GoogleGenAI } from "@google/genai";
import { validatePlaceholders } from "./locale";

export type TranslationItem = { key: string; source: string };
export type GeminiUsage = {
  promptTokenCount: number;
  candidatesTokenCount: number;
  thoughtsTokenCount: number;
  totalTokenCount: number;
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          translation: { type: "string" },
        },
        required: ["key", "translation"],
        additionalProperties: false,
      },
    },
  },
  required: ["translations"],
  additionalProperties: false,
} as const;

function promptFor(items: TranslationItem[], sourceLocale: string, targetLocale: string) {
  return `Translate Shopify theme locale strings from ${sourceLocale} to ${targetLocale}. Return every key exactly once. Preserve all Liquid expressions, {{ placeholders }}, %{placeholders}, HTML tags, whitespace meaning, and brand names. Do not translate keys.\n\n${JSON.stringify(items)}`;
}

export async function translateBatch(
  items: TranslationItem[],
  sourceLocale: string,
  targetLocale: string,
  apiKey: string,
  model: string,
): Promise<{ translations: Record<string, string>; usage: GeminiUsage }> {
  if (!items.length) {
    return {
      translations: {},
      usage: { promptTokenCount: 0, candidatesTokenCount: 0, thoughtsTokenCount: 0, totalTokenCount: 0 },
    };
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: promptFor(items, sourceLocale, targetLocale),
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: RESPONSE_SCHEMA,
      temperature: 0.2,
    },
  });
  if (!response.text) throw new Error("Gemini returned an empty response");
  const parsed = JSON.parse(response.text) as {
    translations?: Array<{ key?: unknown; translation?: unknown }>;
  };
  const requested = new Map(items.map((item) => [item.key, item.source]));
  const translations: Record<string, string> = {};

  for (const result of parsed.translations ?? []) {
    if (typeof result.key !== "string" || typeof result.translation !== "string") continue;
    const source = requested.get(result.key);
    if (source === undefined || result.key in translations) continue;
    const invalid = validatePlaceholders(source, result.translation);
    if (invalid.length) {
      throw new Error(`Gemini changed protected tokens for ${result.key}: ${invalid.join(", ")}`);
    }
    translations[result.key] = result.translation;
  }
  const missing = items.filter(({ key }) => !(key in translations));
  if (missing.length) throw new Error(`Gemini omitted ${missing.length} translation(s)`);
  const metadata = response.usageMetadata;
  return {
    translations,
    usage: {
      promptTokenCount: metadata?.promptTokenCount ?? 0,
      candidatesTokenCount: metadata?.candidatesTokenCount ?? 0,
      thoughtsTokenCount: metadata?.thoughtsTokenCount ?? 0,
      totalTokenCount: metadata?.totalTokenCount ?? 0,
    },
  };
}

export async function countTranslationTokens(
  items: TranslationItem[],
  sourceLocale: string,
  targetLocale: string,
  apiKey: string,
  model: string,
) {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.countTokens({
    model,
    contents: promptFor(items, sourceLocale, targetLocale),
  });
  return response.totalTokens ?? 0;
}

export function isRetryableGeminiError(error: unknown) {
  return error instanceof ApiError && (error.status === 429 || error.status >= 500);
}
