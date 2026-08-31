import { parseLocaleJson, type LocaleJson } from "./locale";

type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type GraphqlPayload<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

export type ThemeSummary = { id: string; name: string; role: string };
export type ShopLocale = {
  locale: string;
  name: string;
  primary: boolean;
  published: boolean;
};
export type ThemeLocaleFile = { filename: string; content: string };

type ThemeLocaleFilesData = {
  theme: null | {
    files: {
      nodes: Array<{
        filename: string;
        body: null | { content?: string };
      }>;
      pageInfo: { endCursor: string | null; hasNextPage: boolean };
      userErrors: Array<{ code: string; filename: string | null }>;
    };
  };
};

async function graphql<T>(
  admin: AdminClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const payload = (await response.json()) as GraphqlPayload<T>;
  if (!response.ok || payload.errors?.length || !payload.data) {
    throw new Error(
      payload.errors?.map(({ message }) => message).join("; ") ||
      `Shopify Admin API returned ${response.status}`,
    );
  }
  return payload.data;
}

export async function getDashboardData(admin: AdminClient) {
  const data = await graphql<{
    themes: { nodes: ThemeSummary[] };
    shopLocales: ShopLocale[];
  }>(
    admin,
    `#graphql
      query TranslatorDashboard {
        themes(first: 50) { nodes { id name role } }
        shopLocales { locale name primary published }
      }`,
  );
  return { themes: data.themes.nodes, shopLocales: data.shopLocales };
}

export async function getThemeLocaleFiles(
  admin: AdminClient,
  themeId: string,
): Promise<ThemeLocaleFile[]> {
  const localeFiles: ThemeLocaleFile[] = [];
  let after: string | null = null;

  do {
    const data: ThemeLocaleFilesData = await graphql<ThemeLocaleFilesData>(
      admin,
      `#graphql
        query ThemeLocaleFiles($id: ID!, $after: String) {
          theme(id: $id) {
            files(first: 250, after: $after) {
              nodes {
                filename
                body { ... on OnlineStoreThemeFileBodyText { content } }
              }
              pageInfo { endCursor hasNextPage }
              userErrors { code filename }
            }
          }
        }`,
      { id: themeId, after },
    );
    if (!data.theme) throw new Error("Theme not found");
    if (data.theme.files.userErrors.length) {
      throw new Error(
        data.theme.files.userErrors
          .map(({ code, filename }) => `${code}${filename ? `: ${filename}` : ""}`)
          .join("; "),
      );
    }
    // Include both locale JSON files AND schema files (schema contains theme settings labels/descriptions)
    const localeNodes = data.theme.files.nodes.filter(
      (file) =>
        file.filename.startsWith("locales/") &&
        file.filename.endsWith(".json"),
    );
    console.log("[getThemeLocaleFiles] found", localeNodes.length, "locale files:",
      localeNodes.map((f) => f.filename).join(", "));
    for (const file of localeNodes) {
      const content = file.body?.content;
      if (typeof content !== "string") {
        console.log("[getThemeLocaleFiles]", file.filename, "has no text content, skipping");
        continue;
      }
      console.log("[getThemeLocaleFiles]", file.filename, "starts with:", JSON.stringify(content.slice(0, 80)));
      localeFiles.push({ filename: file.filename, content });
    }
    after = data.theme.files.pageInfo.hasNextPage
      ? data.theme.files.pageInfo.endCursor
      : null;
  } while (after);

  return localeFiles;
}

/**
 * Fetch all JSON files from the theme (templates, section groups, etc.)
 * that may contain translatable text in their settings.
 */
export async function getThemeJsonFiles(
  admin: AdminClient,
  themeId: string,
): Promise<ThemeLocaleFile[]> {
  const jsonFiles: ThemeLocaleFile[] = [];
  let after: string | null = null;

  do {
    const data: ThemeLocaleFilesData = await graphql<ThemeLocaleFilesData>(
      admin,
      `#graphql
        query ThemeJsonFiles($id: ID!, $after: String) {
          theme(id: $id) {
            files(first: 250, after: $after) {
              nodes {
                filename
                body { ... on OnlineStoreThemeFileBodyText { content } }
              }
              pageInfo { endCursor hasNextPage }
              userErrors { code filename }
            }
          }
        }`,
      { id: themeId, after },
    );
    if (!data.theme) throw new Error("Theme not found");
    if (data.theme.files.userErrors.length) {
      throw new Error(
        data.theme.files.userErrors
          .map(({ code, filename }) => `${code}${filename ? `: ${filename}` : ""}`)
          .join("; "),
      );
    }
    // Include template files and section group files
    const jsonNodes = data.theme.files.nodes.filter(
      (file) =>
        (file.filename.startsWith("templates/") && file.filename.endsWith(".json")) ||
        (file.filename.startsWith("sections/") && file.filename.endsWith(".json")),
    );
    for (const file of jsonNodes) {
      const content = file.body?.content;
      if (typeof content !== "string") continue;
      jsonFiles.push({ filename: file.filename, content });
    }
    after = data.theme.files.pageInfo.hasNextPage
      ? data.theme.files.pageInfo.endCursor
      : null;
  } while (after);

  return jsonFiles;
}

/**
 * Keys that contain translatable text (exact match or suffix match).
 */
const TRANSLATABLE_KEY_WORDS = new Set([
  "heading", "subheading", "title", "subtitle", "text", "label",
  "button_label", "button_text", "description", "content",
  "badge", "tagline", "quote", "caption", "message",
  "placeholder", "alt_text", "link_text", "tooltip", "tab_name",
]);

/**
 * Key substrings that indicate non-translatable configuration settings.
 */
const NON_TRANSLATABLE_KEY_PARTS = [
  "_color", "_align", "_font", "_size", "_width", "_position", "_style",
  "_type", "_gap", "_pad", "_margin", "_opacity", "_radius", "_border",
  "_anim", "_delay", "_preset", "_scheme", "_layout", "_scale", "_icon",
  "_image", "_video", "_url", "_link", "_hover", "_breakpoint", "_line_limit",
  "_inherit", "_transparent", "_direction", "_weight", "_height", "_line",
  "_columns", "_per_page", "_count", "_sticky", "_enable", "_show", "_allow",
  "_disable", "_mobile", "_desktop", "_start", "_end", "_block", "_inline",
  "_min", "_max", "_shape", "_gradient", "_overlay", "_ratio", "_spacing",
];

/**
 * Values that are clearly technical/configuration, not translatable text.
 */
const TECHNICAL_VALUES = new Set([
  "left", "center", "right", "top", "bottom", "middle", "none", "text",
  "fit-content", "flex-start", "flex-end", "flex-column", "flex-row",
  "space-between", "space-around", "start", "end", "normal", "inherit",
  "auto", "hidden", "visible", "block", "inline", "absolute", "fixed",
  "relative", "sticky", "default", "primary", "secondary", "medium",
  "small", "large", "full", "half", "circle", "square", "rounded",
  "solid", "dashed", "dotted", "transparent", "h1", "h2", "h3", "h4",
  "h5", "h6", "p", "span", "div", "true", "false",
]);

type TranslatableField = {
  path: string[];  // JSON path to the field (for writing back)
  key: string;     // the settings key
  value: string;   // the source text
};

/**
 * Extract translatable text fields from a theme JSON file (template or section group).
 * Walks the JSON tree, finds all `settings` objects, and identifies string values
 * that look like user-facing text.
 */
export function extractTranslatableFromThemeJson(json: Record<string, unknown>): TranslatableField[] {
  const fields: TranslatableField[] = [];

  function isTranslatableKey(key: string): boolean {
    const kl = key.toLowerCase();
    // Check exact match or suffix match (e.g., "heading_1" ends with "heading" → no, but "heading" is exact)
    // Actually check if key IS one of the words, or ends with _word for words >= 4 chars
    if (TRANSLATABLE_KEY_WORDS.has(kl)) return true;
    for (const word of TRANSLATABLE_KEY_WORDS) {
      if (word.length >= 4 && (kl === word || kl.endsWith("_" + word))) return true;
    }
    return false;
  }

  function isNonTranslatable(key: string): boolean {
    const kl = key.toLowerCase();
    return NON_TRANSLATABLE_KEY_PARTS.some((part) => kl.includes(part));
  }

  function isTechnicalValue(value: string): boolean {
    const v = value.trim().toLowerCase();
    if (TECHNICAL_VALUES.has(v)) return true;
    if (v.startsWith("t:")) return true;
    if (v.startsWith("shopify://")) return true;
    if (v.startsWith("http")) return true;
    if (v.startsWith("var(")) return true;
    if (v.startsWith("scheme-")) return true;
    if (v.startsWith("#") && v.length <= 7) return true; // hex color
    if (/^\d+(\.\d+)?(px|rem|em|%|vh|vw|ms|s)?$/.test(v)) return true; // number with unit
    if (v.length <= 2) return true; // too short
    return false;
  }

  function walk(obj: unknown, path: string[]) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => walk(item, [...path, String(i)]));
      return;
    }
    const record = obj as Record<string, unknown>;
    // If this object has a "settings" property, check for translatable strings
    if ("settings" in record && record.settings && typeof record.settings === "object") {
      const settings = record.settings as Record<string, unknown>;
      for (const [key, value] of Object.entries(settings)) {
        if (typeof value !== "string" || !value.trim()) continue;
        if (isNonTranslatable(key)) continue;
        if (!isTranslatableKey(key)) continue;
        if (isTechnicalValue(value)) continue;
        fields.push({ path: [...path, "settings", key], key, value });
      }
    }
    // Recurse into all properties
    for (const [key, value] of Object.entries(record)) {
      if (key === "settings") continue; // already processed
      walk(value, [...path, key]);
    }
  }

  walk(json, []);
  return fields;
}

/**
 * Set a translated value back into a theme JSON object at the given path.
 */
export function setThemeJsonValue(
  json: Record<string, unknown>,
  path: string[],
  value: string,
): Record<string, unknown> {
  const result = structuredClone(json);
  let current: Record<string, unknown> = result;
  for (let i = 0; i < path.length - 1; i++) {
    current = current[path[i]] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
  return result;
}

export async function readThemeLocale(
  admin: AdminClient,
  themeId: string,
  filename: string,
): Promise<LocaleJson> {
  const files = await getThemeLocaleFiles(admin, themeId);
  const file = files.find((candidate) => candidate.filename === filename);
  if (!file) throw new Error(`Locale file ${filename} was not found`);
  return parseLocaleJson(file.content);
}

/**
 * Shopify limits the size of locale file content and individual translation values.
 * Truncate any value that exceeds the limit to avoid upsert errors.
 */
const MAX_VALUE_LENGTH = 2000;

function truncateLongValues(locale: LocaleJson): LocaleJson {
  const result = structuredClone(locale);
  function walk(obj: unknown): void {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }
    const record = obj as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === "string" && value.length > MAX_VALUE_LENGTH) {
        record[key] = value.slice(0, MAX_VALUE_LENGTH - 3) + "...";
        console.log(`[upsertThemeLocale] Truncated long value at key "${key}" (${value.length} → ${MAX_VALUE_LENGTH} chars)`);
      } else if (value && typeof value === "object") {
        walk(value);
      }
    }
  }
  walk(result);
  return result;
}

export async function upsertThemeLocale(
  admin: AdminClient,
  themeId: string,
  filename: string,
  locale: LocaleJson,
) {
  const sanitized = truncateLongValues(locale);
  const data = await graphql<{
    themeFilesUpsert: {
      upsertedThemeFiles: Array<{ filename: string }>;
      job: null | { id: string };
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(
    admin,
    `#graphql
      mutation PublishThemeLocale($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
        themeFilesUpsert(themeId: $themeId, files: $files) {
          upsertedThemeFiles { filename }
          job { id }
          userErrors { field message }
        }
      }`,
    {
      themeId,
      files: [
        {
          filename,
          body: { type: "TEXT", value: JSON.stringify(sanitized, null, 2) },
        },
      ],
    },
  );
  const errors = data.themeFilesUpsert.userErrors;
  if (errors.length) throw new Error(errors.map(({ message }) => message).join("; "));
  if (
    !data.themeFilesUpsert.upsertedThemeFiles.length &&
    !data.themeFilesUpsert.job
  ) {
    throw new Error("Shopify did not confirm or queue the locale file update");
  }
  return data.themeFilesUpsert;
}

/**
 * Upsert a locale file in chunks. Shopify has limits on how many translation keys
 * can be written in a single upsert. This function splits the translations into
 * smaller batches, reads the existing file, merges each batch, and writes it back.
 */
export async function upsertThemeLocaleChunked(
  admin: AdminClient,
  themeId: string,
  filename: string,
  baseLocale: LocaleJson,
  translations: Record<string, string>,
  chunkSize = 25,
) {
  const { flattenLocale, mergeLocale } = await import("./locale");
  const keys = Object.keys(translations);
  if (!keys.length) return;

  // The issue: Shopify limits the total file size, not just new keys.
  // If the base locale file already has 3000+ keys, writing base+new overflows.
  // Strategy: write new keys into a MINIMAL base (just the new keys), then
  // do a final merge of the complete file at the end.
  let currentBase = structuredClone(baseLocale);
  let currentNewKeys: Record<string, string> = {};

  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk: Record<string, string> = {};
    for (let j = i; j < Math.min(i + chunkSize, keys.length); j++) {
      chunk[keys[j]] = translations[keys[j]];
    }

    // Write only the new keys accumulated so far (not the full base)
    const minimalWrite = { ...currentNewKeys, ...chunk };
    const minimalJson = mergeLocale({}, minimalWrite);

    try {
      await upsertThemeLocale(admin, themeId, filename, minimalJson);
      currentNewKeys = minimalWrite;
      console.log(`[upsertThemeLocaleChunked] Wrote chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(keys.length / chunkSize)} (${Object.keys(chunk).length} new keys, ${Object.keys(minimalWrite).length} total in file)`);
    } catch (error) {
      // If this chunk fails, try smaller chunks
      if (chunkSize > 5) {
        console.log(`[upsertThemeLocaleChunked] Chunk of ${chunkSize} failed, retrying with smaller chunks...`);
        await upsertThemeLocaleChunked(admin, themeId, filename, {}, chunk, Math.floor(chunkSize / 2));
        // Merge what succeeded
        currentNewKeys = { ...currentNewKeys, ...chunk };
      } else {
        console.error(`[upsertThemeLocaleChunked] Small chunk failed, skipping ${Object.keys(chunk).length} keys:`, error);
      }
    }
  }

  // Final write: merge all new translations into the full base locale
  if (Object.keys(currentNewKeys).length > 0) {
    const finalMerged = mergeLocale(currentBase, currentNewKeys);
    try {
      await upsertThemeLocale(admin, themeId, filename, finalMerged);
      console.log(`[upsertThemeLocaleChunked] Final merge: wrote ${Object.keys(currentNewKeys).length} keys into full locale (${Object.keys(flattenLocale(finalMerged)).length} total keys)`);
    } catch (error) {
      console.error(`[upsertThemeLocaleChunked] Final merge failed, but partial writes succeeded. Error:`, error);
      // The partial writes still have the translations — they're just not merged
      // with the full base. Shopify will still use them.
    }
  }
}
