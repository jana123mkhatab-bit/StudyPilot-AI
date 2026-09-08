import "server-only";
import { MongoClient, type Db, type Document, type Collection } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;

/** MongoDB is optional for the offline/demo experience. */
export const databaseConfigured = Boolean(uri && dbName);

type MongoCache = {
  client?: MongoClient;
  db?: Db;
  connecting?: Promise<Db>;
  indexes?: Promise<void>;
};

const globalForMongo = globalThis as typeof globalThis & { __studyPilotMongo?: MongoCache };
const cache = globalForMongo.__studyPilotMongo ?? (globalForMongo.__studyPilotMongo = {});

async function createIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection("students").createIndex({ email: 1 }, { unique: true }),
    db.collection("courses").createIndex({ studentId: 1 }),
    db.collection("exams").createIndex({ studentId: 1 }),
    db.collection("exams").createIndex({ courseId: 1 }),
    db.collection("exams").createIndex({ courseId: 1, examDate: 1 }),
    db.collection("materials").createIndex({ studentId: 1 }),
    db.collection("materials").createIndex({ courseId: 1 }),
    db.collection("lectureAnalyses").createIndex({ materialId: 1 }),
    db.collection("assessments").createIndex({ studentId: 1 }),
    db.collection("assessments").createIndex({ courseId: 1 }),
    db.collection("knowledgeProfiles").createIndex({ studentId: 1 }),
    db.collection("knowledgeProfiles").createIndex({ studentId: 1, courseId: 1 }),
    db.collection("studyPlans").createIndex({ studentId: 1 }),
    db.collection("tutor_conversations").createIndex({ studentId: 1, courseId: 1, updatedAt: -1 }),
    db.collection("tutor_messages").createIndex({ conversationId: 1, createdAt: 1 }),
    db.collection("videoRecommendationCache").createIndex({ studentId: 1, courseId: 1, topicKey: 1 }, { unique: true }),
    db.collection("videoRecommendationCache").createIndex({ fetchedAt: 1 }, { expireAfterSeconds: 604800 }),
    db.collection("passwordResets").createIndex({ tokenHash: 1 }, { unique: true }),
    db.collection("passwordResets").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("calendarEvents").createIndex({ studentId: 1, date: 1 }),
    db.collection("notifications").createIndex({ studentId: 1, createdAt: -1 }),
    db.collection("focusSessions").createIndex({ studentId: 1, startedAt: -1 }),
    db.collection("focusSessions").createIndex({ studentId: 1, status: 1 }),
    db.collection("professorCourses").createIndex({ professorId: 1 }),
    db.collection("professorMaterials").createIndex({ professorCourseId: 1 }),
    db.collection("rubrics").createIndex({ professorCourseId: 1 }),
    db.collection("examBlueprints").createIndex({ professorCourseId: 1 }, { unique: true }),
    db.collection("professorAssessments").createIndex({ professorCourseId: 1 }),
    db.collection("document_chunks").createIndex({ materialId: 1 }),
    db.collection("document_chunks").createIndex({ courseId: 1, studentId: 1 }),
    db.collection("document_chunks").createIndex({ materialId: 1, chunkIndex: 1 }),
  ]);
  await ensureVectorSearchIndex(db).catch((error) => {
    console.error("Failed to ensure the document_chunks vector search index exists:", error instanceof Error ? error.message : error);
  });
}

export const VECTOR_INDEX_NAME = "document_chunks_vector_index";
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Atlas Search indexes are a separate API from regular indexes and take ~10-20s to become
 * queryable — created once, fire-and-forget (not awaited to READY) so a cold start never blocks
 * on it. Idempotent: skips creation if the index already exists (checked on every cold start,
 * which is cheap — only the one-time creation itself is slow).
 */
async function ensureVectorSearchIndex(db: Db): Promise<void> {
  const collection = db.collection("document_chunks");
  const existing = await collection.listSearchIndexes(VECTOR_INDEX_NAME).toArray().catch(() => []);
  if (existing.length > 0) return;
  await collection.createSearchIndex({
    name: VECTOR_INDEX_NAME,
    type: "vectorSearch",
    definition: {
      fields: [
        { type: "vector", path: "embedding", numDimensions: EMBEDDING_DIMENSIONS, similarity: "cosine" },
        { type: "filter", path: "courseId" },
        { type: "filter", path: "studentId" },
      ],
    },
  });
}

/** Return a cached Mongo database, or null if unconfigured or unreachable (offline/demo experience). */
export async function getDatabase(): Promise<Db | null> {
  if (!databaseConfigured || !uri || !dbName) return null;
  if (!cache.db) cache.connecting ??= (async () => {
    try {
      cache.client ??= new MongoClient(uri, { maxPoolSize: 10, serverSelectionTimeoutMS: 5_000 });
      await cache.client.connect();
      cache.db = cache.client.db(dbName);
      return cache.db;
    } catch (error) {
      cache.connecting = undefined;
      cache.client = undefined;
      throw error;
    }
  })();
  try {
    await cache.connecting;
  } catch {
    return null;
  }
  const db = cache.db;
  if (!db) return null;
  cache.indexes ??= createIndexes(db).catch((error) => {
    cache.indexes = undefined;
    throw error;
  });
  try {
    await cache.indexes;
  } catch {
    return db;
  }
  return db;
}

export async function getCollection<T extends Document = Document>(
  name: string
): Promise<Collection<T> | null> {
  const db = await getDatabase();
  return db?.collection<T>(name) ?? null;
}

export function now(): Date {
  return new Date();
}
