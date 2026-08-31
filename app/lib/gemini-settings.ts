export const GEMINI_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.0-flash-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
] as const;

export const GLM_MODELS = [
  "glm-4.5-flash",
  "glm-4.7-flash",
  "glm-4.5-air",
  "glm-4.5",
  "glm-4.7",
  "glm-5.2",
] as const;

export const MINIMAX_MODELS = [
  "MiniMax-M3",
  "MiniMax-M2.7",
  "MiniMax-M2.7-highspeed",
  "MiniMax-M2.5",
  "MiniMax-M2.5-highspeed",
  "MiniMax-M2.1",
  "MiniMax-M2",
] as const;

export const GROQ_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "qwen/qwen3-32b",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
] as const;

export const AI_PROVIDERS = ["gemini", "glm", "minimax", "groq"] as const;

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
export const DEFAULT_GLM_MODEL = "glm-4.5-flash";
export const DEFAULT_MINIMAX_MODEL = "MiniMax-M3";
export const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
export const DEFAULT_AI_PROVIDER = "gemini";
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
