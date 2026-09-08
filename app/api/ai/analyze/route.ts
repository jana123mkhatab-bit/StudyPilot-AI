import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AIInputError, AIProviderError, analyzeLecture, extractMaterialText } from "@/lib/ai";
import { getCourseForStudent } from "@/lib/server-course";
import { toLectureAnalysisDoc } from "@/lib/lecture-analysis";
import { getCollection, now } from "@/lib/db";
import { requireStudentId, UnauthorizedError } from "@/lib/server-session";
import { rateLimited } from "@/lib/server-http";
import { ingestMaterial } from "@/lib/rag/ingestion";
import type { LectureAnalysisDoc, MaterialDoc } from "@/lib/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  let studentId: string;
  try {
    studentId = await requireStudentId();
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    throw error;
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > 10 * 1024 * 1024 + 64 * 1024) {
    return NextResponse.json({ error: "Uploads must be smaller than 10 MB." }, { status: 413 });
  }
  if (rateLimited(`analysis:${studentId}`, 5, 60_000)) {
    return NextResponse.json({ error: "Too many analysis requests. Please try again shortly." }, { status: 429 });
  }
  try {
    const form = await request.formData();
    const courseId = form.get("courseId");
    const fileName = form.get("fileName");
    const file = form.get("file");
    if (typeof courseId !== "string" || typeof fileName !== "string" || !(file instanceof File)) {
      return NextResponse.json({ error: "courseId, fileName, and a file are required." }, { status: 400 });
    }
    const course = await getCourseForStudent(studentId, courseId);
    if (!course) throw new AIInputError("Course not found. Create the course first.");

    const material = await extractMaterialText(file);
    const result = await analyzeLecture(courseId, fileName.slice(0, 200), material, course);

    const materials = await getCollection<MaterialDoc>("materials");
    const analyses = await getCollection<LectureAnalysisDoc>("lectureAnalyses");
    const materialId = randomUUID();
    const materialDoc: MaterialDoc = {
      _id: materialId,
      studentId,
      courseId,
      fileName: fileName.slice(0, 200),
      fileType: file.type || "text/plain",
      fileUrl: null,
      materialType: "lecture",
      uploadDate: now(),
      processingStatus: "completed",
      extractedText: material,
    };
    await materials?.insertOne(materialDoc);
    await analyses?.insertOne(toLectureAnalysisDoc(result, materialId, courseId));
    const rag = await ingestMaterial(materialDoc);

    return NextResponse.json({ ...result, material, materialId, rag: { status: rag.status, chunkCount: rag.chunkCount } });
  } catch (error) {
    const status = error instanceof AIInputError ? 400 : error instanceof AIProviderError ? 502 : 500;
    const message =
      error instanceof AIProviderError
        ? "The analysis service is temporarily unavailable. Please try again."
        : error instanceof Error
          ? error.message
          : "Unable to analyze this material.";
    return NextResponse.json({ error: message }, { status });
  }
}
