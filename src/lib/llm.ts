import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({ apiKey: process.env.AI_DATA_PLANE_OPENROUTER_API_KEY! });

export const sqlGenModel = openrouter.chat(process.env.SQL_GEN_MODEL ?? "openai/gpt-4o-mini");
export const embeddingModel = openrouter.textEmbeddingModel(
  process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small"
);

export interface CallStats {
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
}
