import "server-only";

export type AIProviderName = "gemini" | "openai";

export type AIErrorCategory =
  | "invalid_api_key"
  | "not_configured"
  | "timeout"
  | "rate_limit"
  | "network"
  | "malformed_response"
  | "empty_response"
  | "unavailable"
  | "unknown";

export type AITaskType =
  | "tutor_chat"
  | "lecture_analysis"
  | "assessment_generate"
  | "assessment_grade"
  | "health_check";

export interface AIUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AIResponse {
  text: string;
  provider: AIProviderName;
  model: string;
  finishReason?: string;
  usage?: AIUsage;
  requestId: string;
  latencyMs: number;
}

export type StreamEvent =
  | { type: "start"; provider: AIProviderName; model: string; requestId: string }
  | { type: "delta"; text: string }
  | { type: "done"; response: AIResponse }
  | { type: "error"; category: AIErrorCategory; message: string };

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateTextRequest {
  systemInstruction: string;
  userMessage: string;
  history?: ChatTurn[];
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  requestId?: string;
  /** Ties the provider call to the caller's cancellation (e.g. the client aborting an SSE fetch). */
  signal?: AbortSignal;
}

export interface GenerateStructuredRequest<T> extends GenerateTextRequest {
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  /** Throws AIProviderError on invalid shape; returns the narrowed, business-validated value otherwise. */
  validate: (value: unknown) => T;
}

export interface HealthCheckResult {
  provider: AIProviderName;
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}

export interface AIProvider {
  readonly name: AIProviderName;
  isConfigured(): boolean;
  generateText(request: GenerateTextRequest): Promise<AIResponse>;
  generateStructured<T>(request: GenerateStructuredRequest<T>): Promise<{ data: T; response: AIResponse }>;
  streamText(request: GenerateTextRequest): AsyncGenerator<StreamEvent>;
  healthCheck(): Promise<HealthCheckResult>;
}

export class AIInputError extends Error {}

export class AIProviderError extends Error {
  category: AIErrorCategory;
  provider?: AIProviderName;
  constructor(message: string, category: AIErrorCategory = "unknown", provider?: AIProviderName) {
    super(message);
    this.category = category;
    this.provider = provider;
  }
}

export class AIConfigError extends AIProviderError {
  constructor(message: string, provider?: AIProviderName) {
    super(message, "not_configured", provider);
  }
}

/** Transient categories are safe to retry on a fallback provider; the rest indicate a request/config problem that would repeat. */
export function isRetryableCategory(category: AIErrorCategory): boolean {
  return category === "timeout" || category === "network" || category === "unavailable" || category === "rate_limit";
}
