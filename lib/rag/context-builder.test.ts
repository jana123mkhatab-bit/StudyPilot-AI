import { describe, it, expect } from "vitest";
import { buildRagContext } from "./context-builder";
import type { RetrievedChunk } from "./retrieval";

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    materialId: "m1",
    fileName: "lecture-4.txt",
    chunkIndex: 0,
    content: "Normalization reduces redundancy.",
    pageNumber: null,
    section: null,
    score: 0.8,
    ...overrides,
  };
}

describe("buildRagContext", () => {
  it("reports no evidence for an empty chunk list", () => {
    const context = buildRagContext([]);
    expect(context.hasEvidence).toBe(false);
    expect(context.formattedContext).toBeUndefined();
    expect(context.sources).toEqual([]);
  });

  it("formats a single chunk with a numbered source label", () => {
    const context = buildRagContext([chunk()]);
    expect(context.hasEvidence).toBe(true);
    expect(context.formattedContext).toContain("[Source 1: lecture-4.txt]");
    expect(context.formattedContext).toContain("Normalization reduces redundancy.");
  });

  it("includes page number in the label when available, omits it when null", () => {
    const withPage = buildRagContext([chunk({ pageNumber: 7 })]);
    expect(withPage.formattedContext).toContain("page 7");

    const withoutPage = buildRagContext([chunk({ pageNumber: null })]);
    expect(withoutPage.formattedContext).not.toContain("page");
  });

  it("numbers multiple sources sequentially and preserves retrieval order", () => {
    const context = buildRagContext([
      chunk({ chunkIndex: 2, content: "Second concept." }),
      chunk({ chunkIndex: 0, content: "First concept." }),
    ]);
    const firstBlockIndex = context.formattedContext!.indexOf("[Source 1:");
    const secondBlockIndex = context.formattedContext!.indexOf("[Source 2:");
    expect(firstBlockIndex).toBeGreaterThanOrEqual(0);
    expect(secondBlockIndex).toBeGreaterThan(firstBlockIndex);
    expect(context.formattedContext!.indexOf("Second concept.")).toBeLessThan(context.formattedContext!.indexOf("First concept."));
  });

  it("maps every retrieved chunk to a citation with matching metadata", () => {
    const context = buildRagContext([chunk({ materialId: "m2", chunkIndex: 5, score: 0.91 })]);
    expect(context.sources).toEqual([
      { materialId: "m2", fileName: "lecture-4.txt", chunkIndex: 5, pageNumber: null, section: null, score: 0.91 },
    ]);
  });
});
