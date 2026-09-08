import "server-only";
import { getCollection, VECTOR_INDEX_NAME } from "../db";
import type { DocumentChunkDoc } from "../models";
import { getEmbeddingProvider } from "./embedding-service";

export interface RetrievedChunk {
  materialId: string;
  fileName: string;
  chunkIndex: number;
  content: string;
  pageNumber: number | null;
  section: string | null;
  score: number;
}

export interface SearchRelevantChunksInput {
  query: string;
  courseId: string;
  studentId: string;
  materialId?: string;
  limit?: number;
  /** Minimum cosine similarity (0-1) to keep a match — filters out results too weak to be useful. */
  threshold?: number;
}

const DEFAULT_LIMIT = 6;
const DEFAULT_THRESHOLD = 0.55;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function toRetrievedChunk(doc: DocumentChunkDoc, score: number): RetrievedChunk {
  return {
    materialId: doc.materialId,
    fileName: doc.fileName,
    chunkIndex: doc.chunkIndex,
    content: doc.content,
    pageNumber: doc.pageNumber,
    section: doc.section,
    score,
  };
}

/**
 * course/student scoped chunk retrieval. Tries Atlas $vectorSearch first; if the search index isn't
 * queryable yet (freshly created — see ensureVectorSearchIndex in lib/db.ts) or the call errors,
 * falls back to brute-force cosine similarity over that course's chunks. The brute-force path is
 * only viable because this app's expected corpus per course is small (a handful of lecture files);
 * it is NOT a substitute for vector search at scale.
 *
 * courseId + studentId are both required and both filtered on — a student's course records are
 * private to them in this app's data model, but filtering on both is cheap insurance against ever
 * retrieving another student's material even if that assumption changes later.
 */
export async function searchRelevantChunks(input: SearchRelevantChunksInput): Promise<RetrievedChunk[]> {
  const { query, courseId, studentId, materialId, limit = DEFAULT_LIMIT, threshold = DEFAULT_THRESHOLD } = input;
  const collection = await getCollection<DocumentChunkDoc>("document_chunks");
  if (!collection) return [];

  const provider = getEmbeddingProvider();
  if (!provider.isConfigured()) return [];

  const [queryVector] = await provider.embedBatch([query], "query");
  if (!queryVector) return [];

  try {
    const filter: Record<string, unknown> = { courseId, studentId };
    if (materialId) filter.materialId = materialId;

    const results = await collection
      .aggregate<DocumentChunkDoc & { score: number }>([
        {
          $vectorSearch: {
            index: VECTOR_INDEX_NAME,
            path: "embedding",
            queryVector,
            numCandidates: Math.max(limit * 10, 50),
            limit,
            filter,
          },
        },
        { $set: { score: { $meta: "vectorSearchScore" } } },
      ])
      .toArray();

    if (results.length > 0) {
      return results.filter((r) => r.score >= threshold).map((r) => toRetrievedChunk(r, r.score));
    }
    // Empty result can mean either "genuinely nothing relevant" or "index not queryable yet" —
    // fall through to the brute-force path to distinguish the two rather than guessing.
  } catch {
    // $vectorSearch can fail outright (e.g. index still PENDING) — fall back below.
  }

  const candidates = await collection
    .find(materialId ? { courseId, studentId, materialId } : { courseId, studentId })
    .limit(500)
    .toArray();
  return candidates
    .map((doc) => ({ doc, score: cosineSimilarity(queryVector, doc.embedding) }))
    .filter((c) => c.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) => toRetrievedChunk(c.doc, c.score));
}
