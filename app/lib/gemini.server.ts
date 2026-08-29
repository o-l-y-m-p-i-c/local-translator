import { ApiError, GoogleGenAI } from "@google/genai";
import { validatePlaceholders } from "./locale";

export type TranslationItem = { key: string; source: string };
export type TranslationContext = {
  resourceType?: string; // e.g. "PRODUCT", "COLLECTION", "PAGE", "LINK"
  resourceName?: string; // e.g. "Mustard Ochre 100g Cup", "Privacy Policy"
  fields?: string[]; // e.g. ["title", "body_html", "meta_description"]
  force?: boolean; // when true, use aggressive prompt to prevent untranslated strings
  glossary?: Record<string, string>; // established translations for consistency
};
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

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  PRODUCT: "a product (title, description, meta fields, variant names, options like color/size/material)",
  COLLECTION: "a product collection or category",
  ARTICLE: "a blog post",
  BLOG: "a blog",
  PAGE: "a store page (e.g., About, Contact, Privacy Policy)",
  METAOBJECT: "a metaobject (custom data like filters, specifications, brand info)",
  SHOP: "store metadata (cookie banner, notifications, shipping info, store settings)",
  SHOP_POLICY: "a legal policy (refund, privacy, terms of service, shipping)",
  LINK: "a navigation menu item",
  THEME: "theme content (UI labels, section settings, template text, app embeds)",
};

function promptFor(items: TranslationItem[], sourceLocale: string, targetLocale: string, context?: TranslationContext) {
  const sourceName = localeDisplayName(sourceLocale);
  const targetName = localeDisplayName(targetLocale);

  const resourceContext = context?.resourceType
    ? `\n- You are translating content for: ${RESOURCE_TYPE_LABELS[context.resourceType] || context.resourceType}`
    : "";
  const nameContext = context?.resourceName
    ? `\n- Resource name: "${context.resourceName}" — use this to understand the context of ambiguous words`
    : "";
  const fieldsContext = context?.fields?.length
    ? `\n- Fields being translated: ${context.fields.join(", ")}`
    : "";

  // Glossary: established translations from previous batches for consistency
  const glossaryEntries = Object.entries(context?.glossary ?? {});
  const glossaryContext = glossaryEntries.length
    ? `\n\nCONSISTENCY GLOSSARY — When you encounter these EXACT phrases in the source text, use the established translation. Do NOT use synonyms or alternatives for these complete phrases:\n${glossaryEntries.map(([src, tgt]) => `  "${src}" → "${tgt}"`).join("\n")}\n`
    : "";

  // Resource-type-specific guidance
  const typeSpecific = context?.resourceType === "LINK"
    ? `\n- These are NAVIGATION MENU ITEMS for a store. They are NOT brand names. "Glitter Cups" means "cups with glitter effect". "Signature Cups" means "premium/flagship cups". "Custom Cups" means "made-to-order cups". Translate ALL such phrases.`
    : context?.resourceType === "COLLECTION"
      ? `\n- These are COLLECTION/CATEGORY names. They describe product types, not brands. Translate them fully.`
      : context?.resourceType === "PRODUCT"
        ? `\n- These are product names and descriptions. Descriptive words like "Glitter", "Signature", "Custom", "Mini", "Classic" are adjectives, not brand names. Translate them.`
        : "";

  // Force mode: aggressive instruction to not return strings unchanged
  const forcePrefix = context?.force
    ? `CRITICAL INSTRUCTION: The following strings were previously returned UNCHANGED (not translated). This is a FAILURE. You MUST translate every single string to ${targetName}. Do NOT return any string identical to the source. If a string looks like a brand name, it is NOT — it is a product category or menu item. Translate it. Even single words like "Cups", "Glitter", "Signature" MUST be translated to ${targetName}.

`
    : "";

  return `${forcePrefix}You are a professional translator working on content for a Shopify e-commerce store.

Context:
- Source language: ${sourceName} (${sourceLocale})
- Target language: ${targetName} (${targetLocale})
- Platform: Shopify online store${resourceContext}${nameContext}${fieldsContext}${typeSpecific}${glossaryContext}

IMPORTANT — Disambiguation:
- Words like "Orange", "Rose", "Olive", "Coral", "Navy", "Cream", "Mint", "Sand", "Stone" can be colors OR objects. In a Shopify store context, when translating product names, variant options, collection names, or filter values, these almost always refer to COLORS, not fruits/objects. Translate them as colors.
- When translating variant option values (e.g., color names, size names, material names), translate the descriptive meaning (e.g., "Mustard Ochre" → the color, not the condiment).
- Use the resource name and field name as context clues. If the resource is "Mustard Ochre 100g Cup" and the field is a color option, "Mustard Ochre" is a color name.

Rules:
1. Translate each string from ${sourceName} to ${targetName}. Translate EVERYTHING — including product names, category names, collection names, menu items, and single words. Returning any English string unchanged is a FAILURE.
2. Return every key exactly once, using the same key in the response.
3. Preserve ALL Liquid expressions exactly: {{ }}, {% %}, {{- -}} tokens.
4. Preserve ALL placeholder tokens: {{ count }}, {{ product_title }}, %{placeholder}, etc.
5. Preserve HTML tag structure (tag names, nesting) but DO translate text inside HTML attributes like data-description, alt, title, placeholder, aria-label when they contain user-facing text.
6. Do NOT keep anything untranslated. The ONLY exceptions are: registered trademarks (™, ®), and proper nouns with NO established translation in ${targetName} (person names, city names). Everything else — including "Glitter Cups", "Signature Cups", "Custom Cups", "Mini", "Classic" — MUST be translated.
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
  context?: TranslationContext,
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
    contents: promptFor(items, sourceLocale, targetLocale, context),
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

  // Post-translation check: detect strings that Gemini returned UNCHANGED (not translated).
  // Retry those with force mode to aggressively force translation.
  if (!context?.force) {
    const untranslated = items.filter(({ key, source }) =>
      translations[key] === source && source.trim().length > 0
    );
    if (untranslated.length) {
      console.log(`[translateBatch] ${untranslated.length} string(s) returned unchanged, retrying with force mode...`);
      const retryContext = { ...context, force: true };
      const retryResult = await translateBatch(untranslated, sourceLocale, targetLocale, apiKey, model, retryContext);
      // Merge retry results, but only accept translations that are actually different
      for (const { key } of untranslated) {
        const retried = retryResult.translations[key];
        if (retried && retried !== translations[key]) {
          translations[key] = retried;
        }
      }
    }
  }

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
  context?: TranslationContext,
) {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.countTokens({
    model,
    contents: promptFor(items, sourceLocale, targetLocale, context),
  });
  return response.totalTokens ?? 0;
}

export function isRetryableGeminiError(error: unknown) {
  return error instanceof ApiError && (error.status === 429 || error.status >= 500);
}

/**
 * Build a glossary from completed translations.
 * Only tracks FULL PHRASE matches (not word-level) to avoid incorrect mappings.
 * Short source strings (≤ 3 words, ≤ 40 chars) that were successfully translated
 * are added to the glossary so the same phrase is translated consistently.
 */
export function buildGlossary(
  translations: Array<{ source: string; target: string }>,
  existingGlossary: Record<string, string> = {},
): Record<string, string> {
  const glossary = { ...existingGlossary };

  for (const { source, target } of translations) {
    if (!source || !target || source === target) continue;

    // Only track short phrases (single words or short multi-word terms)
    // This avoids mapping long descriptions where word alignment is unreliable
    const wordCount = source.trim().split(/\s+/).length;
    const isShortPhrase = wordCount <= 3 && source.length <= 40;

    if (!isShortPhrase) continue;

    // Normalize the key (lowercase, trimmed) to catch repeated terms
    const key = source.trim().toLowerCase();

    // Don't override existing entries (first translation wins for consistency)
    if (key in glossary) continue;

    // Only add if the translation is actually different from the source
    if (target.trim() && target.trim() !== source.trim()) {
      glossary[key] = target.trim();
    }
  }

  return glossary;
}
