import "server-only";
import { randomUUID } from "node:crypto";
import { getCollection } from "../db";
import type { DocumentChunkDoc, MaterialDoc } from "../models";
import { chunkText } from "./chunking";
import { getEmbeddingProvider } from "./embedding-service";

export interface IngestionResult {
  status: "ready" | "skipped" | "failed";
  chunkCount: number;
  error?: string;
}

/**
 * Chunks a material's extracted text, embeds each chunk, and (re)stores them in document_chunks.
 * Idempotent: always deletes any chunks from a prior run for this materialId first, so reprocessing
 * (or a retry after failure) never leaves duplicate or orphaned embeddings behind.
 *
 * Runs synchronously as part of the upload request rather than a background job — the documents
 * this app handles (a handful of lecture files per course) embed in a few seconds, and a separate
 * job queue would be unwarranted infrastructure for that.
 */
export async function ingestMaterial(material: MaterialDoc): Promise<IngestionResult> {
  const materials = await getCollection<MaterialDoc>("materials");
  const chunksCollection = await getCollection<DocumentChunkDoc>("document_chunks");
  if (!materials || !chunksCollection) return { status: "skipped", chunkCount: 0 };

  const text = material.extractedText?.trim();
  if (!text) {
    await materials.updateOne({ _id: material._id }, { $set: { ragStatus: "failed", ragError: "No extracted text to index." } });
    return { status: "failed", chunkCount: 0, error: "No extracted text to index." };
  }

  await materials.updateOne({ _id: material._id }, { $set: { ragStatus: "processing" } });

  try {
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      await materials.updateOne({ _id: material._id }, { $set: { ragStatus: "failed", ragError: "No chunkable content found." } });
      return { status: "failed", chunkCount: 0, error: "No chunkable content found." };
    }

    const provider = getEmbeddingProvider();
    if (!provider.isConfigured()) {
      await materials.updateOne({ _id: material._id }, { $set: { ragStatus: "failed", ragError: "Embedding provider is not configured." } });
      return { status: "failed", chunkCount: 0, error: "Embedding provider is not configured." };
    }

    const embeddings = await provider.embedBatch(
      chunks.map((c) => c.content),
      "document"
    );

    const docs: DocumentChunkDoc[] = chunks.map((chunk, index) => ({
      _id: randomUUID(),
      materialId: material._id,
      courseId: material.courseId,
      studentId: material.studentId,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      fileName: material.fileName,
      materialType: material.materialType,
      pageNumber: null,
      section: null,
      embedding: embeddings[index],
      embeddingModel: provider.model,
      createdAt: new Date(),
    }));

    // Replace strategy: delete first, then insert — reprocessing never accumulates duplicates.
    await chunksCollection.deleteMany({ materialId: material._id });
    await chunksCollection.insertMany(docs);

    await materials.updateOne({ _id: material._id }, { $set: { ragStatus: "completed", ragIndexedAt: new Date() }, $unset: { ragError: "" } });
    return { status: "ready", chunkCount: docs.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Indexing failed.";
    await materials.updateOne({ _id: material._id }, { $set: { ragStatus: "failed", ragError: message } });
    return { status: "failed", chunkCount: 0, error: message };
  }
}
