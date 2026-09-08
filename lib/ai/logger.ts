import "server-only";
import type { AIErrorCategory, AIProviderName, AITaskType, AIUsage } from "./types";

export interface AIRequestLog {
  requestId: string;
  taskType: AITaskType;
  provider: AIProviderName;
  model: string;
  latencyMs: number;
  success: boolean;
  errorCategory?: AIErrorCategory;
  usage?: AIUsage;
  userId?: string;
  courseId?: string;
  fallbackFrom?: AIProviderName;
}

/**
 * Logs only safe, non-sensitive metadata — never prompts, message content, or credentials.
 * Swap the sink for a real observability backend later without touching call sites.
 */
export function logAIRequest(entry: AIRequestLog): void {
  const line = {
    at: new Date().toISOString(),
    event: "ai_request",
    ...entry,
  };
  if (entry.success) {
    console.log(JSON.stringify(line));
  } else {
    console.error(JSON.stringify(line));
  }
}
