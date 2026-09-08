import { describe, it, expect } from "vitest";
import { sanitizeSchemaForGemini } from "./gemini-provider";
import { ASSESSMENT_SCHEMA, GRADE_SCHEMA, LECTURE_ANALYSIS_SCHEMA, TUTOR_REPLY_SCHEMA } from "../schemas";

/**
 * Regression guard: Gemini's responseSchema is a restricted OpenAPI 3.0 subset that rejects
 * `additionalProperties` with an HTTP 400 (unlike OpenAI, which requires it for strict Structured
 * Outputs). Every schema we hand to Gemini must have that keyword stripped, at every nesting level.
 */
function collectKeys(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (key in (value as Record<string, unknown>)) return true;
  return Object.values(value as Record<string, unknown>).some((v) => collectKeys(v, key));
}

describe("sanitizeSchemaForGemini", () => {
  it("strips additionalProperties at the top level", () => {
    const sanitized = sanitizeSchemaForGemini({ type: "object", properties: {}, additionalProperties: false });
    expect(sanitized.additionalProperties).toBeUndefined();
  });

  it("strips additionalProperties from nested object properties", () => {
    const sanitized = sanitizeSchemaForGemini({
      type: "object",
      properties: {
        outer: { type: "object", properties: { inner: { type: "string" } }, additionalProperties: false },
      },
      additionalProperties: false,
    });
    expect(collectKeys(sanitized, "additionalProperties")).toBe(false);
  });

  it("strips additionalProperties from array item schemas", () => {
    const sanitized = sanitizeSchemaForGemini({
      type: "array",
      items: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false },
    });
    expect(collectKeys(sanitized, "additionalProperties")).toBe(false);
  });

  it("preserves the schema's actual constraints", () => {
    const sanitized = sanitizeSchemaForGemini({
      type: "object",
      properties: { content: { type: "string" } },
      required: ["content"],
      additionalProperties: false,
    });
    expect(sanitized).toEqual({
      type: "object",
      properties: { content: { type: "string" } },
      required: ["content"],
    });
  });

  it.each([
    ["TUTOR_REPLY_SCHEMA", TUTOR_REPLY_SCHEMA.schema],
    ["LECTURE_ANALYSIS_SCHEMA", LECTURE_ANALYSIS_SCHEMA.schema],
    ["ASSESSMENT_SCHEMA", ASSESSMENT_SCHEMA.schema],
    ["GRADE_SCHEMA", GRADE_SCHEMA.schema],
  ])("leaves no additionalProperties anywhere in %s", (_name, schema) => {
    const sanitized = sanitizeSchemaForGemini(schema as Record<string, unknown>);
    expect(collectKeys(sanitized, "additionalProperties")).toBe(false);
  });
});
