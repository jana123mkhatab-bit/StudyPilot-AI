import "server-only";
import type { RetrievedChunk } from "./retrieval";

export interface RagSource {
  materialId: string;
  fileName: string;
  chunkIndex: number;
  pageNumber: number | null;
  section: string | null;
  score: number;
}

export interface RagContext {
  /** Formatted for direct insertion into buildSystemInstruction's retrievedContext field; undefined when nothing matched. */
  formattedContext?: string;
  sources: RagSource[];
  hasEvidence: boolean;
}

/**
 * Builds the "RETRIEVED MATERIAL" prompt block and the citation list shown in the UI. Chunks
 * are labeled by filename (+ page/section when the extraction pipeline actually captured it —
 * see chunking.ts's note on why that's usually null today) so the model can cite what it used.
 */
export function buildRagContext(chunks: RetrievedChunk[]): RagContext {
  if (chunks.length === 0) {
    return { sources: [], hasEvidence: false };
  }

  const blocks = chunks.map((chunk, index) => {
    const label = [chunk.fileName, chunk.section, chunk.pageNumber ? `page ${chunk.pageNumber}` : null]
      .filter(Boolean)
      .join(" — ");
    return `[Source ${index + 1}: ${label}]\n${chunk.content}`;
  });

  return {
    formattedContext: blocks.join("\n\n"),
    sources: chunks.map((chunk) => ({
      materialId: chunk.materialId,
      fileName: chunk.fileName,
      chunkIndex: chunk.chunkIndex,
      pageNumber: chunk.pageNumber,
      section: chunk.section,
      score: chunk.score,
    })),
    hasEvidence: true,
  };
}
