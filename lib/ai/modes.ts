// Deliberately NOT server-only: the tutor chat UI (a client component) needs ChatMode and the
// selectable-mode list to render its persona picker, while lib/ai/prompts.ts (server-only) uses
// the same type to build the system prompt. Keep this file free of secrets/server logic.

export type ChatMode =
  | "GENERAL"
  | "COURSE"
  | "MATERIAL"
  | "TUTOR"
  | "EXAM_COACH"
  | "SOCRATIC"
  | "BEGINNER"
  | "CODING_MENTOR";

export const CHAT_MODES: ChatMode[] = [
  "GENERAL",
  "COURSE",
  "MATERIAL",
  "TUTOR",
  "EXAM_COACH",
  "SOCRATIC",
  "BEGINNER",
  "CODING_MENTOR",
];

export function isChatMode(value: unknown): value is ChatMode {
  return typeof value === "string" && (CHAT_MODES as string[]).includes(value);
}

/** The persona-style modes a student can actually pick in the tutor chat UI. */
export const SELECTABLE_CHAT_MODES: { mode: ChatMode; label: string }[] = [
  { mode: "TUTOR", label: "Tutor" },
  { mode: "EXAM_COACH", label: "Exam Coach" },
  { mode: "SOCRATIC", label: "Socratic" },
  { mode: "BEGINNER", label: "Beginner" },
  { mode: "CODING_MENTOR", label: "Coding Mentor" },
];
