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

export type GeminiModel = (typeof GEMINI_MODELS)[number];

export function parseGeminiModel(value: string): GeminiModel {
  if (!GEMINI_MODELS.includes(value as GeminiModel)) {
    throw new Error("Select a supported Gemini model");
  }
  return value as GeminiModel;
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
