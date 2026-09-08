import "server-only";
import { AI_CONFIG, isProviderConfigured } from "../ai/config";
import { AIConfigError, AIProviderError } from "../ai/types";
import { EMBEDDING_DIMENSIONS } from "../db";

export type EmbeddingTaskType = "document" | "query";

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  isConfigured(): boolean;
  embedBatch(texts: string[], taskType: EmbeddingTaskType): Promise<number[][]>;
}

const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const GEMINI_EMBEDDING_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}`;
/** Gemini batches up to 100 requests per call; keep well under that so one slow batch doesn't eat the whole timeout budget. */
const BATCH_SIZE = 32;

function toGeminiTaskType(taskType: EmbeddingTaskType): "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" {
  return taskType === "document" ? "RETRIEVAL_DOCUMENT" : "RETRIEVAL_QUERY";
}

/**
 * The embedding model used for indexing and querying must stay identical — mixing models (or
 * output dimensions) produces vectors that aren't comparable. gemini-embedding-001 is the only
 * embedding model wired up (OpenAI embeddings are gated behind the same OPENAI_DISABLED switch
 * as chat, in lib/ai/config.ts).
 */
export const geminiEmbeddingProvider: EmbeddingProvider = {
  name: "gemini",
  model: GEMINI_EMBEDDING_MODEL,
  dimensions: EMBEDDING_DIMENSIONS,

  isConfigured() {
    return isProviderConfigured("gemini");
  },

  async embedBatch(texts: string[], taskType: EmbeddingTaskType): Promise<number[][]> {
    const apiKey = AI_CONFIG.providers.gemini.apiKey;
    if (!apiKey) throw new AIConfigError("Gemini is not configured.", "gemini");
    if (texts.length === 0) return [];

    const results: number[][] = [];
    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const batch = texts.slice(start, start + BATCH_SIZE);
      const response = await fetch(`${GEMINI_EMBEDDING_ENDPOINT}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: batch.map((text) => ({
            model: `models/${GEMINI_EMBEDDING_MODEL}`,
            content: { parts: [{ text }] },
            taskType: toGeminiTaskType(taskType),
            outputDimensionality: EMBEDDING_DIMENSIONS,
          })),
        }),
      });
      if (!response.ok) {
        const category = response.status === 429 ? "rate_limit" : response.status >= 500 ? "unavailable" : "unknown";
        throw new AIProviderError(`Gemini embedding request failed (${response.status}).`, category, "gemini");
      }
      const payload = (await response.json()) as { embeddings?: { values?: number[] }[] };
      const vectors = payload.embeddings?.map((e) => e.values ?? []);
      if (!vectors || vectors.length !== batch.length || vectors.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
        throw new AIProviderError("Gemini returned malformed embeddings.", "malformed_response", "gemini");
      }
      results.push(...vectors);
    }
    return results;
  },
};

export function getEmbeddingProvider(): EmbeddingProvider {
  return geminiEmbeddingProvider;
}
