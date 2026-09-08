import { NextResponse } from "next/server";
import { AIInputError } from "@/lib/ai";
import { getCourseForStudent } from "@/lib/server-course";
import { requireStudentId, UnauthorizedError } from "@/lib/server-session";
import { rateLimited, tooLarge, cleanText } from "@/lib/server-http";
import { searchRelevantChunks } from "@/lib/rag/retrieval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Direct retrieval endpoint — lets you inspect what the chat's RAG layer would retrieve for a
 * given question without going through a full chat turn. Useful for the retrieval-quality /
 * course-isolation checks called for in the sprint's evaluation section.
 */
export async function POST(request: Request) {
  let studentId: string;
  try {
    studentId = await requireStudentId();
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    throw error;
  }
  if (rateLimited(`rag-search:${studentId}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many search requests. Please try again shortly." }, { status: 429 });
  }
  if (tooLarge(request)) return NextResponse.json({ error: "Request is too large." }, { status: 413 });

  try {
    const body = (await request.json()) as { courseId?: unknown; query?: unknown; materialId?: unknown; limit?: unknown };
    const courseId = cleanText(body.courseId, 100);
    const query = cleanText(body.query, 2_000);
    if (!courseId || !query) throw new AIInputError("courseId and query are required.");

    const course = await getCourseForStudent(studentId, courseId);
    if (!course) throw new AIInputError("Course not found. Select a saved course first.");

    const materialId = typeof body.materialId === "string" ? body.materialId.slice(0, 100) : undefined;
    const limit = typeof body.limit === "number" ? Math.min(20, Math.max(1, Math.trunc(body.limit))) : undefined;

    const chunks = await searchRelevantChunks({ query, courseId, studentId, materialId, limit });
    return NextResponse.json({ chunks });
  } catch (error) {
    const status = error instanceof AIInputError ? 400 : 500;
    const message = error instanceof Error ? error.message : "Unable to search course materials.";
    return NextResponse.json({ error: message }, { status });
  }
}
