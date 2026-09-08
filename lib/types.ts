export type MasteryState = "strong" | "practicing" | "weak" | "untested";

export interface Concept {
  id: string;
  name: string;
  mastery: number; // 0-100
  state: MasteryState;
  dependsOn?: string[]; // concept ids that should be understood first
}

export type SubjectCategory =
  | "Computer Science"
  | "Engineering"
  | "Business"
  | "Medicine"
  | "Science"
  | "Humanities";

export interface Course {
  id: string;
  code: string; // e.g. "CS 301"
  name: string; // e.g. "Algorithms"
  professor: string;
  subject: SubjectCategory;
  color: "terracotta" | "sage" | "gold";
  concepts: Concept[];
  examDate?: string; // ISO date
  progressPct: number; // syllabus coverage
  hasMaterials?: boolean; // false for a course added during onboarding with nothing uploaded yet
  priority?: "low" | "medium" | "high";
}

export interface ProfessorFocusItem {
  conceptId: string;
  conceptName: string;
  stars: 1 | 2 | 3 | 4 | 5;
  evidence: string[]; // e.g. "Appears in 4 lectures"
  rationale: string;
}

export type QuestionType =
  | "multiple-choice"
  | "true-false"
  | "short-answer"
  | "conceptual"
  | "problem-solving"
  | "scenario";

export interface AssessmentQuestion {
  id: string;
  type: QuestionType;
  conceptId: string;
  prompt: string;
  choices?: string[];
  correctIndex?: number;
  difficulty: "easy" | "medium" | "hard";
}

export interface AssessmentResult {
  id: string;
  courseId: string;
  date: string;
  scorePct: number;
  strengths: string[];
  gaps: string[];
  aiExplanation: string;
}

export interface ExplanationSettings {
  length: "brief" | "standard" | "detailed";
  stepByStep: boolean;
  simplifiedVocabulary: boolean;
  examplesFirst: boolean;
  chunked: boolean;
}

export interface AnalysisResult {
  fileName: string;
  courseId: string;
  analysisSource?: "gemini" | "openai" | "fallback";
  learningObjectives: string[];
  importantConcepts: { name: string; importance: number }[];
  assessmentPatterns: string[];
  dependencies: { concept: string; requires: string[] }[];
}

export interface TutorSource {
  materialId: string;
  fileName: string;
  chunkIndex: number;
  pageNumber: number | null;
  section: string | null;
  score: number;
}

export interface TutorMessage {
  role: "user" | "assistant";
  content: string;
  groundedIn?: string;
  /** Present on AI-generated assistant replies; absent on user messages and deterministic fallback replies. */
  provider?: "gemini" | "openai";
  model?: string;
  /** RAG citations — present when the reply was grounded in retrieved course-material chunks. */
  sources?: TutorSource[];
}

export interface GradeResult {
  scorePct: number;
  strengths: string[];
  gaps: string[];
  aiExplanation: string;
}

export interface StudySession {
  id: string;
  day: string; // "Monday" etc, or ISO date
  time: string; // "4:00 PM"
  courseId: string;
  conceptName: string;
  minutes: number;
  kind: "focus" | "practice" | "review" | "assessment" | "break";
  done?: boolean;
  addedToCalendar?: boolean;
}

export interface Technique {
  id: string;
  name: string;
  blurb: string;
}

export interface ResourceRecommendation {
  id: string;
  gapConceptId: string;
  title: string;
  type: "video" | "article" | "practice-set" | "interactive";
  why: string;
  durationMinutes: number;
}

export interface VideoRecommendation {
  videoId: string;
  title: string;
  channelTitle: string;
  description: string;
  thumbnailUrl: string;
  publishedAt: string;
  durationSeconds: number | null;
  durationLabel: string | null;
  url: string;
  matchedTopics: string[];
  relevanceScore: number;
  reason: string;
  qualitySignals: string[];
  recommendationConfidence: "high" | "medium" | "low";
}
