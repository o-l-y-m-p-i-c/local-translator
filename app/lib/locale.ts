export type LocaleJson = Record<string, unknown>;
export type FlatLocale = Record<string, string>;
export type TranslationStatus = "missing" | "stale" | "translated";
export type StatusMap = Record<string, TranslationStatus>;

const encodeSegment = (segment: string) =>
  segment.replaceAll("~", "~0").replaceAll("/", "~1");

const decodeSegment = (segment: string) =>
  segment.replaceAll("~1", "/").replaceAll("~0", "~");

export function flattenLocale(value: unknown, path = ""): FlatLocale {
  if (typeof value === "string") return { [path || "/"]: value };
  if (!value || typeof value !== "object") return {};

  return Object.entries(value).reduce<FlatLocale>((result, [key, child]) => {
    const childPath = `${path}/${encodeSegment(key)}`;
    return Object.assign(result, flattenLocale(child, childPath));
  }, {});
}

export function setLocaleValue(root: LocaleJson, pointer: string, value: string) {
  const segments = pointer
    .split("/")
    .slice(1)
    .map(decodeSegment);
  if (!segments.length) return root;

  let current: Record<string, unknown> = root;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      current[segment] = value;
      return;
    }
    const child = current[segment];
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  });
  return root;
}

export function mergeLocale(source: LocaleJson, translations: FlatLocale): LocaleJson {
  const merged = structuredClone(source);
  Object.entries(translations).forEach(([key, value]) =>
    setLocaleValue(merged, key, value),
  );
  return merged;
}

export function unflattenLocale(flat: FlatLocale): LocaleJson {
  return mergeLocale({}, flat);
}

export function computeStatuses(
  source: FlatLocale,
  target: FlatLocale,
  previousSource: FlatLocale = {},
): StatusMap {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => {
      const translation = target[key]?.trim();
      if (!translation) return [key, "missing"];
      if (key in previousSource && previousSource[key] !== value) {
        return [key, "stale"];
      }
      return [key, "translated"];
    }),
  );
}

const TOKEN_PATTERNS = [
  /{{-?[\s\S]*?-?}}/g,
  /{%[-]?[\s\S]*?[-]?%}/g,
  /%\{[^}]+}/g,
  /<\/?[a-zA-Z][^>]*>/g,
];

export function extractPlaceholders(value: string): string[] {
  return TOKEN_PATTERNS.flatMap((pattern) => value.match(pattern) ?? []).sort();
}

export function validatePlaceholders(source: string, translation: string): string[] {
  const expected = extractPlaceholders(source);
  const actual = extractPlaceholders(translation);
  const errors: string[] = [];
  const counts = (tokens: string[]) =>
    tokens.reduce<Record<string, number>>((map, token) => {
      map[token] = (map[token] ?? 0) + 1;
      return map;
    }, {});
  const expectedCounts = counts(expected);
  const actualCounts = counts(actual);

  for (const [token, count] of Object.entries(expectedCounts)) {
    if ((actualCounts[token] ?? 0) !== count) errors.push(token);
  }
  for (const token of Object.keys(actualCounts)) {
    if (!(token in expectedCounts)) errors.push(token);
  }
  return [...new Set(errors)];
}

export function parseLocaleJson(content: string): LocaleJson {
  let jsonContent = content.trimStart();
  // Some theme locale files may have a comment header before the JSON object.
  // Try to find the first `{` and parse from there.
  if (!jsonContent.startsWith("{")) {
    const braceIdx = jsonContent.indexOf("{");
    if (braceIdx === -1) {
      throw new Error(`Locale file does not contain a JSON object (starts with "${jsonContent.slice(0, 40)}...")`);
    }
    jsonContent = jsonContent.slice(braceIdx);
  }
  const parsed: unknown = JSON.parse(jsonContent);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Locale file must contain a JSON object");
  }
  return parsed as LocaleJson;
}

export function localeFilenameFor(sourceFilename: string, locale: string) {
  return `locales/${locale}${sourceFilename.endsWith(".schema.json") ? ".schema" : ""}.json`;
}

export function localeFromFilename(filename: string) {
  return filename
    .split("/")
    .pop()
    ?.replace(/\.json$/, "")
    .replace(/\.schema$/, "")
    .replace(/\.default$/, "") ?? "";
}
