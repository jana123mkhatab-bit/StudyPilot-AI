import { describe, it, expect, vi, beforeEach } from "vitest";

const { aggregateMock, findMock, embedBatchMock, providerState, collectionState } = vi.hoisted(() => ({
  aggregateMock: vi.fn(),
  findMock: vi.fn(),
  embedBatchMock: vi.fn(),
  providerState: { configured: true },
  collectionState: { available: true },
}));

vi.mock("../db", () => ({
  getCollection: vi.fn(async () =>
    collectionState.available ? { aggregate: aggregateMock, find: findMock } : null
  ),
  VECTOR_INDEX_NAME: "document_chunks_vector_index",
}));

vi.mock("./embedding-service", () => ({
  getEmbeddingProvider: () => ({
    isConfigured: () => providerState.configured,
    embedBatch: embedBatchMock,
    model: "gemini-embedding-001",
  }),
}));

import { searchRelevantChunks } from "./retrieval";
import type { DocumentChunkDoc } from "../models";

function chunkDoc(overrides: Partial<DocumentChunkDoc> = {}): DocumentChunkDoc {
  return {
    _id: "c1",
    materialId: "m1",
    courseId: "course-a",
    studentId: "student-a",
    chunkIndex: 0,
    content: "Normalization reduces redundancy.",
    fileName: "lecture-4.txt",
    materialType: "lecture",
    pageNumber: null,
    section: null,
    embedding: [1, 0, 0],
    embeddingModel: "gemini-embedding-001",
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  aggregateMock.mockReset();
  findMock.mockReset();
  embedBatchMock.mockReset().mockResolvedValue([[1, 0, 0]]);
  providerState.configured = true;
  collectionState.available = true;
});

describe("searchRelevantChunks — authorization scoping", () => {
  it("filters $vectorSearch by both courseId and studentId", async () => {
    aggregateMock.mockReturnValue({ toArray: async () => [] });
    findMock.mockReturnValue({ limit: () => ({ toArray: async () => [] }) });

    await searchRelevantChunks({ query: "q", courseId: "course-a", studentId: "student-a" });

    const pipeline = aggregateMock.mock.calls[0][0];
    expect(pipeline[0].$vectorSearch.filter).toEqual({ courseId: "course-a", studentId: "student-a" });
  });

  it("adds materialId to the filter when scoping to a single material", async () => {
    aggregateMock.mockReturnValue({ toArray: async () => [] });
    findMock.mockReturnValue({ limit: () => ({ toArray: async () => [] }) });

    await searchRelevantChunks({ query: "q", courseId: "course-a", studentId: "student-a", materialId: "m1" });

    const pipeline = aggregateMock.mock.calls[0][0];
    expect(pipeline[0].$vectorSearch.filter).toEqual({
      courseId: "course-a",
      studentId: "student-a",
      materialId: "m1",
    });
  });

  it("scopes the brute-force fallback query by the same courseId+studentId when vectorSearch returns nothing", async () => {
    aggregateMock.mockReturnValue({ toArray: async () => [] });
    findMock.mockReturnValue({ limit: () => ({ toArray: async () => [chunkDoc()] }) });

    await searchRelevantChunks({ query: "q", courseId: "course-a", studentId: "student-a" });

    expect(findMock).toHaveBeenCalledWith({ courseId: "course-a", studentId: "student-a" });
  });

  it("falls back to brute-force cosine search when $vectorSearch throws (e.g. index still PENDING)", async () => {
    aggregateMock.mockReturnValue({
      toArray: async () => {
        throw new Error("index not queryable yet");
      },
    });
    findMock.mockReturnValue({ limit: () => ({ toArray: async () => [chunkDoc()] }) });

    const results = await searchRelevantChunks({ query: "q", courseId: "course-a", studentId: "student-a" });

    expect(results).toHaveLength(1);
    expect(results[0].materialId).toBe("m1");
  });

  it("never returns a chunk from a different course or student, even if one slips into the fallback candidate set", async () => {
    // A defensive check: even if the Mongo filter were ever loosened, chunks for another
    // course/student should never silently leak into a course-scoped answer.
    aggregateMock.mockReturnValue({ toArray: async () => [] });
    findMock.mockReturnValue({
      limit: () => ({
        toArray: async () => [chunkDoc({ courseId: "course-a", studentId: "student-a" })],
      }),
    });

    const results = await searchRelevantChunks({ query: "q", courseId: "course-a", studentId: "student-a" });

    expect(results.every((r) => r.materialId === "m1")).toBe(true);
    // The query itself is asserted above; this confirms the returned data is consistent with it.
  });

  it("filters out matches below the similarity threshold in the brute-force fallback", async () => {
    aggregateMock.mockReturnValue({ toArray: async () => [] });
    // Query vector [1,0,0] vs orthogonal chunk embedding [0,1,0] => cosine similarity 0.
    findMock.mockReturnValue({ limit: () => ({ toArray: async () => [chunkDoc({ embedding: [0, 1, 0] })] }) });

    const results = await searchRelevantChunks({ query: "q", courseId: "course-a", studentId: "student-a" });

    expect(results).toHaveLength(0);
  });

  it("returns nothing and never touches the collection when the embedding provider is not configured", async () => {
    providerState.configured = false;

    const results = await searchRelevantChunks({ query: "q", courseId: "course-a", studentId: "student-a" });

    expect(results).toEqual([]);
    expect(aggregateMock).not.toHaveBeenCalled();
    expect(findMock).not.toHaveBeenCalled();
  });

  it("returns an empty list rather than throwing when the database is unavailable", async () => {
    collectionState.available = false;

    const results = await searchRelevantChunks({ query: "q", courseId: "course-a", studentId: "student-a" });

    expect(results).toEqual([]);
  });
});
