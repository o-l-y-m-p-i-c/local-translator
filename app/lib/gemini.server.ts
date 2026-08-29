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
  const sourceName = localeDisplayName(sourceLocale);
  const targetName = localeDisplayName(targetLocale);
  return `You are a professional translator working on locale files for a Shopify e-commerce store.

Context:
- Source language: ${sourceName} (${sourceLocale})
- Target language: ${targetName} (${targetLocale})
- Platform: Shopify online store theme
- File type: JSON locale file used for storefront translations

Rules:
1. Translate each string from ${sourceName} to ${targetName}. Translate EVERYTHING that is user-facing text — including product names, category names, collection names, and menu items. Do NOT leave English text untranslated unless it is a registered trademark or brand logo word.
2. Return every key exactly once, using the same key in the response.
3. Preserve ALL Liquid expressions exactly: {{ }}, {% %}, {{- -}} tokens.
4. Preserve ALL placeholder tokens: {{ count }}, {{ product_title }}, %{placeholder}, etc.
5. Preserve HTML tag structure (tag names, nesting) but DO translate text inside HTML attributes like data-description, alt, title, placeholder, aria-label when they contain user-facing text.
6. The ONLY words to keep untranslated are: registered trademarks (™, ®), company names used as brands, and proper nouns that have no established translation in ${targetName} (e.g., person names, city names). Product category names like "Glitter Cups", "Signature Cups", "Custom Cups" MUST be translated.
7. Keep whitespace and special characters meaningful to the layout.
8. Do NOT translate the keys — only the values.
9. Adapt tone for e-commerce: natural, concise, customer-friendly ${targetName}.
10. For pluralization keys (e.g. "one"/"other"), translate appropriately for the target language's plural rules.
11. Be consistent: if you translate "Cups" to one word in ${targetName}, use that same word everywhere it appears.

Strings to translate:
${JSON.stringify(items)}`;
}

function localeDisplayName(locale: string): string {
  try {
    const display = new Intl.DisplayNames(["en"], { type: "language" });
    const code = locale.replace(/\.default$/, "").replace(/\.schema$/, "");
    return display.of(code) || locale;
  } catch {
    return locale;
  }
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
