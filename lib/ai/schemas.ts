import "server-only";

/**
 * JSON Schemas sent to providers to enable structured output (OpenAI Structured Outputs /
 * Gemini responseSchema). Business-level validation still runs afterward in lib/ai.ts —
 * a provider honoring the schema is necessary but not sufficient (e.g. correctIndex bounds).
 */

export const TUTOR_REPLY_SCHEMA = {
  name: "tutor_reply",
  schema: {
    type: "object",
    properties: {
      content: { type: "string" },
      groundedIn: { type: "string" },
    },
    required: ["content", "groundedIn"],
    additionalProperties: false,
  },
} as const;

export const LECTURE_ANALYSIS_SCHEMA = {
  name: "lecture_analysis",
  schema: {
    type: "object",
    properties: {
      learningObjectives: { type: "array", items: { type: "string" } },
      importantConcepts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            importance: { type: "integer" },
          },
          required: ["name", "importance"],
          additionalProperties: false,
        },
      },
      assessmentPatterns: { type: "array", items: { type: "string" } },
      dependencies: {
        type: "array",
        items: {
          type: "object",
          properties: {
            concept: { type: "string" },
            requires: { type: "array", items: { type: "string" } },
          },
          required: ["concept", "requires"],
          additionalProperties: false,
        },
      },
    },
    required: ["learningObjectives", "importantConcepts", "assessmentPatterns", "dependencies"],
    additionalProperties: false,
  },
} as const;

export const ASSESSMENT_SCHEMA = {
  name: "assessment_questions",
  schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            type: {
              type: "string",
              enum: ["multiple-choice", "true-false", "conceptual", "problem-solving", "scenario"],
            },
            conceptId: { type: "string" },
            prompt: { type: "string" },
            choices: { type: "array", items: { type: "string" } },
            correctIndex: { type: "integer" },
            difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
          },
          required: ["id", "type", "conceptId", "prompt", "choices", "correctIndex", "difficulty"],
          additionalProperties: false,
        },
      },
    },
    required: ["questions"],
    additionalProperties: false,
  },
} as const;

export const GRADE_SCHEMA = {
  name: "assessment_grade",
  schema: {
    type: "object",
    properties: {
      scorePct: { type: "number" },
      strengths: { type: "array", items: { type: "string" } },
      gaps: { type: "array", items: { type: "string" } },
      aiExplanation: { type: "string" },
    },
    required: ["scorePct", "strengths", "gaps", "aiExplanation"],
    additionalProperties: false,
  },
} as const;
