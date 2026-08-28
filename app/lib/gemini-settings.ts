export const GEMINI_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-flash-lite-latest",
  "gemini-flash-latest",
] as const;

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
export const DEFAULT_BATCH_SIZE = 30;
export const MIN_BATCH_SIZE = 1;
export const MAX_BATCH_SIZE = 50;
export const DEFAULT_LAZY_LOAD_PAGE_SIZE = 20;
export const MIN_LAZY_LOAD_PAGE_SIZE = 5;
export const MAX_LAZY_LOAD_PAGE_SIZE = 200;

export function parseGeminiModel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Enter a Gemini model name");
  return trimmed;
}

export function parseBatchSize(value: string) {
  const batchSize = Number(value);
  if (
    !Number.isInteger(batchSize) ||
    batchSize < MIN_BATCH_SIZE ||
    batchSize > MAX_BATCH_SIZE
  ) {
    throw new Error(
      `Batch size must be between ${MIN_BATCH_SIZE} and ${MAX_BATCH_SIZE}`,
    );
  }
  return batchSize;
}

export function parseLazyLoadPageSize(value: string) {
  const pageSize = Number(value);
  if (
    !Number.isInteger(pageSize) ||
    pageSize < MIN_LAZY_LOAD_PAGE_SIZE ||
    pageSize > MAX_LAZY_LOAD_PAGE_SIZE
  ) {
    throw new Error(
      `Page size must be between ${MIN_LAZY_LOAD_PAGE_SIZE} and ${MAX_LAZY_LOAD_PAGE_SIZE}`,
    );
  }
  return pageSize;
}
