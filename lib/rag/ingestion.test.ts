import { describe, it, expect, vi, beforeEach } from "vitest";

const { insertManyMock, deleteManyMock, updateOneMock, embedBatchMock, providerState } = vi.hoisted(() => ({
  insertManyMock: vi.fn(),
  deleteManyMock: vi.fn(),
  updateOneMock: vi.fn(),
  embedBatchMock: vi.fn(),
  providerState: { configured: true },
}));

vi.mock("../db", () => ({
  getCollection: vi.fn(async (name: string) => {
    if (name === "materials") return { updateOne: updateOneMock };
    if (name === "document_chunks") return { deleteMany: deleteManyMock, insertMany: insertManyMock };
    return null;
  }),
}));

vi.mock("./embedding-service", () => ({
  getEmbeddingProvider: () => ({
    isConfigured: () => providerState.configured,
    embedBatch: embedBatchMock,
    model: "gemini-embedding-001",
  }),
}));

import { ingestMaterial } from "./ingestion";
import type { MaterialDoc } from "../models";

function material(overrides: Partial<MaterialDoc> = {}): MaterialDoc {
  return {
    _id: "m1",
    studentId: "student-a",
    courseId: "course-a",
    fileName: "lecture.txt",
    fileType: "text/plain",
    fileUrl: null,
    materialType: "lecture",
    uploadDate: new Date(),
    processingStatus: "completed",
    extractedText: "Paragraph one about ERD.\n\nParagraph two about normalization and candidate keys.",
    ...overrides,
  };
}

beforeEach(() => {
  insertManyMock.mockReset();
  deleteManyMock.mockReset().mockResolvedValue({});
  updateOneMock.mockReset().mockResolvedValue({});
  embedBatchMock.mockReset();
  providerState.configured = true;
});

describe("ingestMaterial", () => {
  it("deletes any prior chunks for the material before inserting the new ones (idempotent replace)", async () => {
    embedBatchMock.mockResolvedValue([
      [1, 0, 0],
      [0, 1, 0],
    ]);

    await ingestMaterial(material());

    expect(deleteManyMock).toHaveBeenCalledWith({ materialId: "m1" });
    expect(insertManyMock).toHaveBeenCalledTimes(1);
    const deleteOrder = deleteManyMock.mock.invocationCallOrder[0];
    const insertOrder = insertManyMock.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(insertOrder);
  });

  it("stamps every chunk with the material's own materialId, studentId, and courseId — never another material's", async () => {
    embedBatchMock.mockResolvedValue([
      [1, 0, 0],
      [0, 1, 0],
    ]);

    await ingestMaterial(material({ _id: "m2", studentId: "student-b", courseId: "course-b" }));

    const docs = insertManyMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(docs.length).toBeGreaterThan(0);
    for (const doc of docs) {
      expect(doc.materialId).toBe("m2");
      expect(doc.studentId).toBe("student-b");
      expect(doc.courseId).toBe("course-b");
      expect(doc.pageNumber).toBeNull();
      expect(doc.section).toBeNull();
    }
  });

  it("reports success with a chunk count matching what chunkText actually produced", async () => {
    // This material's two short paragraphs both fit in one ~1100-char window, so chunkText
    // yields exactly one chunk — only embeddings[0] of the mock is ever consumed.
    embedBatchMock.mockResolvedValue([[1, 0, 0]]);

    const result = await ingestMaterial(material());

    expect(result.status).toBe("ready");
    expect(result.chunkCount).toBe(1);
    expect(insertManyMock.mock.calls[0][0]).toHaveLength(1);
  });

  it("produces multiple chunks (and stores one embedding each) for material long enough to exceed one chunk window", async () => {
    const longParagraph = (topic: string) => `${topic} `.repeat(220).trim(); // ~1600+ chars
    const longText = [longParagraph("Normalization concepts."), longParagraph("Transaction concepts.")].join("\n\n");
    embedBatchMock.mockImplementation(async (texts: string[]) => texts.map(() => [1, 0, 0]));

    const result = await ingestMaterial(material({ extractedText: longText }));

    expect(result.status).toBe("ready");
    expect(result.chunkCount).toBeGreaterThan(1);
    expect(insertManyMock.mock.calls[0][0]).toHaveLength(result.chunkCount);
  });

  it("marks the material failed, without touching chunks, when there is no extracted text", async () => {
    const result = await ingestMaterial(material({ extractedText: "" }));

    expect(result.status).toBe("failed");
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(insertManyMock).not.toHaveBeenCalled();
  });

  it("marks the material failed (not stuck in processing) when the embedding provider is unconfigured", async () => {
    providerState.configured = false;

    const result = await ingestMaterial(material());

    expect(result.status).toBe("failed");
    expect(updateOneMock).toHaveBeenLastCalledWith(
      { _id: "m1" },
      expect.objectContaining({ $set: expect.objectContaining({ ragStatus: "failed" }) })
    );
  });

  it("marks the material failed when the embedding call itself errors mid-flight", async () => {
    embedBatchMock.mockRejectedValue(new Error("embedding service unavailable"));

    const result = await ingestMaterial(material());

    expect(result.status).toBe("failed");
    expect(result.error).toContain("embedding service unavailable");
    expect(insertManyMock).not.toHaveBeenCalled();
  });
});
