import type { TutorSource } from "../types";

export * from "./student";

export interface CourseDoc {
  _id: string;
  studentId: string;
  courseName: string;
  courseCode: string;
  instructor: string;
  credits: number;
  confidenceLevel: number; // 1-5 self-reported confidence scale
  priority: "low" | "medium" | "high";
  /** Not in the spec's required field list — kept for UI theming/categorization, same rationale as MaterialDoc.extractedText. */
  subject?: string;
  color?: "terracotta" | "sage" | "gold";
  createdAt: Date;
  updatedAt: Date;
}

export interface ExamDoc {
  _id: string;
  studentId: string;
  courseId: string;
  examType: "quiz" | "midterm" | "final" | "exam";
  examDate: string; // ISO date
  priority: "low" | "medium" | "high";
  readinessScore: number; // 0-100
  createdAt: Date;
}

export type ProcessingStatus = "pending" | "processing" | "completed" | "failed";
export type MaterialType = "lecture" | "assignment" | "previous_exam" | "quiz" | "notes";

export interface MaterialDoc {
  _id: string;
  studentId: string;
  courseId: string;
  fileName: string;
  fileType: string;
  fileUrl: string | null;
  materialType: MaterialType;
  uploadDate: Date;
  processingStatus: ProcessingStatus;
  /** Derived/processed text used for AI features — not the original file, so it doesn't violate the "no large files in Mongo" rule. */
  extractedText?: string;
  /** RAG chunking/embedding status — separate from processingStatus, which only covers text extraction. */
  ragStatus?: ProcessingStatus;
  ragIndexedAt?: Date;
  ragError?: string;
}

export interface DocumentChunkDoc {
  _id: string;
  materialId: string;
  courseId: string;
  studentId: string;
  chunkIndex: number;
  content: string;
  /** Denormalized from the parent material at ingestion time — avoids a join on every retrieval. */
  fileName: string;
  materialType: MaterialType;
  /** Not populated by the current extraction pipeline (lib/ai.ts doesn't preserve page/slide structure) — left null rather than fabricated. */
  pageNumber: number | null;
  section: string | null;
  embedding: number[];
  embeddingModel: string;
  createdAt: Date;
}

export interface LectureAnalysisDoc {
  _id: string;
  materialId: string;
  courseId: string;
  learningObjectives: string[];
  keyTopics: string[];
  importantConcepts: { name: string; importance: number }[];
  professorFocus: string[];
  difficultyLevels: Record<string, "easy" | "medium" | "hard">;
  generatedAt: Date;
  /** Not in the spec's required field list — preserves the original AI analysis for a lossless round-trip to the frontend's AnalysisResult shape. */
  assessmentPatterns?: string[];
  dependencies?: { concept: string; requires: string[] }[];
  analysisSource?: "gemini" | "openai" | "fallback";
}

export interface TutorConversationDoc {
  id: string;
  studentId: string;
  courseId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TutorMessageDoc {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  groundedIn?: string | null;
  /** Present on AI-generated assistant messages; absent on user messages and deterministic fallback replies. */
  provider?: "gemini" | "openai";
  model?: string;
  sources?: TutorSource[];
  createdAt: Date;
}

export type AssessmentQuestionType =
  | "multiple-choice"
  | "true-false"
  | "short-answer"
  | "conceptual"
  | "problem-solving"
  | "scenario";

export interface AssessmentQuestionDoc {
  question: string;
  type: AssessmentQuestionType;
  options?: string[];
  correctAnswer: string;
  studentAnswer?: string;
  isCorrect?: boolean;
  topic: string;
  /** Not in the spec's required field list — kept so grading/UI can round-trip without a rewrite. */
  id: string;
  conceptId: string;
  difficulty: "easy" | "medium" | "hard";
}

export interface AssessmentDoc {
  _id: string;
  studentId: string;
  courseId: string;
  type: "quiz" | "practice-exam" | "assessment";
  difficulty: "easy" | "medium" | "hard";
  questions: AssessmentQuestionDoc[];
  score: number | null;
  completedAt: Date | null;
  aiFeedback: string | null;
  createdAt: Date;
}

export type MasteryStatus = "weak" | "practicing" | "strong" | "untested";

export interface KnowledgeTopic {
  topic: string;
  mastery: number; // 0-100
  status: MasteryStatus;
  lastAssessed: Date;
  attempts: number;
}

export interface KnowledgeProfileDoc {
  _id: string;
  studentId: string;
  courseId: string;
  topics: KnowledgeTopic[];
}

export interface StudySessionDoc {
  courseId: string;
  topic: string;
  startTime: string;
  duration: number;
  activity: string;
  reason: string;
  status: "pending" | "done" | "skipped";
  /** Not in the spec's required field list — preserves the frontend's day/time/kind for a lossless round-trip. */
  day?: string;
  time?: string;
  kind?: "focus" | "practice" | "review" | "assessment" | "break";
}

export interface StudyPlanDoc {
  _id: string;
  studentId: string;
  mode: "exam" | "normal";
  startDate: string;
  endDate: string;
  status: "active" | "completed" | "archived";
  sessions: StudySessionDoc[];
  createdAt: Date;
}

export interface VideoRecommendationCacheDoc {
  _id: string;
  studentId: string;
  courseId: string;
  topicKey: string;
  topics: string[];
  recommendations: import("@/lib/types").VideoRecommendation[];
  preferenceKey: string;
  fetchedAt: Date;
}

export type CalendarEventType = "study" | "exam" | "review" | "break" | "other";

export interface CalendarEventDoc {
  _id: string;
  studentId: string;
  title: string;
  date: string; // ISO date (YYYY-MM-DD)
  startTime: string;
  endTime: string;
  type: CalendarEventType;
  courseId?: string;
  synced: boolean;
  createdAt: Date;
}

export type NotificationType = "study" | "assessment" | "calendar" | "progress" | "ai-insight" | "accountability";

export interface NotificationDoc {
  _id: string;
  studentId: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  actionLabel?: string;
  actionUrl?: string;
  createdAt: Date;
}

export type FocusMood = "very-tired" | "tired" | "normal" | "good" | "highly-focused" | "stressed";

export interface FocusSessionDoc {
  _id: string;
  studentId: string;
  courseId: string;
  topic: string;
  mood: FocusMood;
  durationMinutes: number;
  elapsedMinutes: number;
  interactions: number;
  correctInteractions: number;
  status: "active" | "paused" | "completed" | "abandoned";
  startedAt: Date;
  completedAt?: Date;
}

// ============================================================
// PROFESSOR TOOLS
// ============================================================

export interface ProfessorCourseDoc {
  _id: string;
  professorId: string;
  courseName: string;
  courseCode: string;
  term: string;
  status: "active" | "archived" | "setup";
  learningObjectives: string[];
  materialsCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfessorMaterialDoc {
  _id: string;
  professorId: string;
  professorCourseId: string;
  fileName: string;
  materialType: MaterialType;
  uploadDate: Date;
  extractedText?: string;
}

export interface RubricLevel {
  label: "Excellent" | "Good" | "Fair" | "Poor";
  description: string;
}

export interface RubricCriterion {
  id: string;
  name: string;
  weight: number;
  levels: RubricLevel[];
}

export interface RubricDoc {
  _id: string;
  professorId: string;
  professorCourseId: string;
  title: string;
  criteria: RubricCriterion[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ExamBlueprintDoc {
  _id: string;
  professorId: string;
  professorCourseId: string;
  topicWeights: { topic: string; weightPct: number }[];
  difficultyDistribution: { easy: number; medium: number; hard: number };
  cognitiveLevels: { recall: number; application: number; analysis: number };
  aiRecommendation?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ProfessorAssessmentQuestionType = "multiple-choice" | "short-answer" | "essay" | "problem";

export interface ProfessorAssessmentQuestionDoc {
  id: string;
  prompt: string;
  type: ProfessorAssessmentQuestionType;
  options?: string[];
  correctAnswer?: string;
  points: number;
  topic: string;
}

export interface ProfessorAssessmentDoc {
  _id: string;
  professorId: string;
  professorCourseId: string;
  title: string;
  questions: ProfessorAssessmentQuestionDoc[];
  status: "draft" | "published";
  createdAt: Date;
  updatedAt: Date;
}
