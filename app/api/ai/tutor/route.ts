import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AIInputError, AIProviderError, askTutor, type AIProviderName } from "@/lib/ai";
import { isChatMode, type ChatMode } from "@/lib/ai/modes";
import type { ExplanationSettings, TutorMessage } from "@/lib/types";
import { getCourseForStudent } from "@/lib/server-course";
import { getCollection } from "@/lib/db";
import { requireStudentId, UnauthorizedError } from "@/lib/server-session";
import { rateLimited, tooLarge } from "@/lib/server-http";
import { explanationStyleAliases, type Student } from "@/lib/models/student";
import type { MaterialDoc, TutorConversationDoc, TutorMessageDoc } from "@/lib/models";

function parseProviderOverride(value: unknown): AIProviderName | undefined {
  return value === "openai" || value === "gemini" ? value : undefined;
}

function parseMode(value: unknown): ChatMode | undefined {
  return isChatMode(value) ? value : undefined;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function explanationSettingsForStudent(student: Student | null | undefined): ExplanationSettings {
  const dyslexia = student?.settings.dyslexiaMode ?? false;
  const focus = student?.settings.focusMode ?? false;
  const style = student?.learningPreferences.explanationStyle;
  const aliases = style ? explanationStyleAliases(style) : { stepByStep: false, brief: false, examplesFirst: false };
  return {
    length: dyslexia || aliases.brief ? "brief" : "standard",
    stepByStep: dyslexia || aliases.stepByStep,
    simplifiedVocabulary: dyslexia || aliases.brief,
    examplesFirst: aliases.examplesFirst,
    chunked: dyslexia || focus,
  };
}

export async function POST(request: Request) {
  let studentId: string;
  try {
    studentId = await requireStudentId();
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    throw error;
  }
  if (rateLimited(`tutor:${studentId}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many tutor requests. Please try again shortly." }, { status: 429 });
  }
  if (tooLarge(request)) return NextResponse.json({ error: "Request is too large." }, { status: 413 });

  try {
    const body = (await request.json()) as {
      courseId?: unknown;
      question?: unknown;
      material?: unknown;
      history?: unknown;
      provider?: unknown;
      mode?: unknown;
    };
    if (typeof body.courseId !== "string" || typeof body.question !== "string") {
      throw new AIInputError("courseId and question are required.");
    }
    const courseId = body.courseId;
    const question = body.question.trim();
    if (!question || question.length > 2_000) throw new AIInputError("Question must be between 1 and 2,000 characters.");

    const history = Array.isArray(body.history)
      ? body.history
          .filter((item): item is TutorMessage =>
            Boolean(
              item &&
                typeof item === "object" &&
                ["user", "assistant"].includes((item as TutorMessage).role) &&
                typeof (item as TutorMessage).content === "string"
            )
          )
          .slice(-8)
          .map((item) => ({ ...item, content: item.content.slice(0, 4_000) }))
      : [];

    let material = typeof body.material === "string" ? body.material.slice(0, 150_000) : "";
    if (!material) {
      const materials = await getCollection<MaterialDoc>("materials");
      const row = await materials?.find({ studentId, courseId }).sort({ uploadDate: -1 }).limit(1).next();
      material = row?.extractedText?.slice(0, 150_000) || "";
    }

    const course = await getCourseForStudent(studentId, courseId);
    if (!course) throw new AIInputError("Course not found. Select a saved course first.");

    const students = await getCollection<Student>("students");
    const student = await students?.findOne({ _id: studentId });
    const settings = explanationSettingsForStudent(student);
    const language = student?.learningPreferences.language;

    const provider = parseProviderOverride(body.provider);
    const mode = parseMode(body.mode);
    const reply = await askTutor(courseId, question, settings, material, history, course, language, {
      provider,
      mode,
      studentId,
    });

    const conversations = await getCollection<TutorConversationDoc>("tutor_conversations");
    const messages = await getCollection<TutorMessageDoc>("tutor_messages");
    if (conversations && messages) {
      const existingConversation = await conversations.findOne(
        { studentId, courseId },
        { sort: { updatedAt: -1 }, projection: { _id: 0, id: 1 } }
      );
      let conversationId = existingConversation?.id;
      if (!conversationId) {
        conversationId = randomUUID();
        const timestamp = new Date();
        await conversations.insertOne({
          id: conversationId,
          studentId,
          courseId,
          title: "Ask My Lecture",
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      await messages.insertMany([
        { id: randomUUID(), conversationId, role: "user", content: question, createdAt: new Date() },
        {
          id: randomUUID(),
          conversationId,
          role: "assistant",
          content: reply.content,
          groundedIn: reply.groundedIn ?? null,
          provider: reply.provider,
          model: reply.model,
          sources: reply.sources,
          createdAt: new Date(),
        },
      ]);
      await conversations.updateOne({ id: conversationId, studentId }, { $set: { updatedAt: new Date() } });
    }

    return NextResponse.json(reply);
  } catch (error) {
    const status = error instanceof AIInputError ? 400 : error instanceof AIProviderError ? 502 : 500;
    const message =
      error instanceof AIProviderError
        ? "The AI tutor is temporarily unavailable. Please try again."
        : error instanceof Error
          ? error.message
          : "Unable to answer right now.";
    return NextResponse.json({ error: message }, { status });
  }
}
