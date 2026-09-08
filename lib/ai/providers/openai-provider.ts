import "server-only";
import { randomUUID } from "node:crypto";
import OpenAI, { APIError, AuthenticationError, RateLimitError } from "openai";
import type { ResponseStreamEvent } from "openai/resources/responses/responses";
import { AI_CONFIG, isProviderConfigured } from "../config";
import {
  AIConfigError,
  AIProviderError,
  type AIErrorCategory,
  type AIProvider,
  type AIResponse,
  type ChatTurn,
  type GenerateStructuredRequest,
  type GenerateTextRequest,
  type HealthCheckResult,
  type StreamEvent,
} from "../types";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  const apiKey = AI_CONFIG.providers.openai.apiKey;
  if (!apiKey) throw new AIConfigError("OpenAI is not configured.", "openai");
  if (!client) client = new OpenAI({ apiKey });
  return client;
}

function historyToInput(history: ChatTurn[] | undefined, userMessage: string) {
  const input = (history ?? []).map((turn) => ({ role: turn.role, content: turn.content }));
  input.push({ role: "user" as const, content: userMessage });
  return input;
}

function categorizeError(error: unknown): AIErrorCategory {
  if (error instanceof AuthenticationError) return "invalid_api_key";
  if (error instanceof RateLimitError) return "rate_limit";
  if (error instanceof OpenAI.APIConnectionTimeoutError) return "timeout";
  if (error instanceof OpenAI.APIConnectionError) return "network";
  if (error instanceof APIError && typeof error.status === "number" && error.status >= 500) return "unavailable";
  return "unknown";
}

function toProviderError(error: unknown): AIProviderError {
  if (error instanceof AIProviderError) return error;
  const category = categorizeError(error);
  const message =
    category === "invalid_api_key"
      ? "OpenAI rejected the configured API key."
      : category === "rate_limit"
        ? "OpenAI rate limit exceeded. Please try again shortly."
        : category === "timeout"
          ? "OpenAI timed out. Please try again."
          : "OpenAI could not be reached.";
  return new AIProviderError(message, category, "openai");
}

export const openaiProvider: AIProvider = {
  name: "openai",

  isConfigured() {
    return isProviderConfigured("openai");
  },

  async generateText(request: GenerateTextRequest): Promise<AIResponse> {
    const openai = getClient();
    const model = AI_CONFIG.providers.openai.model;
    const requestId = request.requestId ?? randomUUID();
    const startedAt = Date.now();
    try {
      const response = await openai.responses.create(
        {
          model,
          instructions: request.systemInstruction,
          input: historyToInput(request.history, request.userMessage),
          temperature: request.temperature ?? 0.2,
          max_output_tokens: request.maxOutputTokens ?? AI_CONFIG.providers.openai.maxOutputTokens,
        },
        { timeout: request.timeoutMs ?? AI_CONFIG.providers.openai.timeoutMs, signal: request.signal }
      );
      const text = response.output_text?.trim();
      if (!text) throw new AIProviderError("OpenAI returned an empty response.", "empty_response", "openai");
      return {
        text,
        provider: "openai",
        model,
        finishReason: response.status,
        usage: response.usage
          ? {
              inputTokens: response.usage.input_tokens,
              outputTokens: response.usage.output_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
        requestId,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      throw toProviderError(error);
    }
  },

  async generateStructured<T>(request: GenerateStructuredRequest<T>) {
    const openai = getClient();
    const model = AI_CONFIG.providers.openai.model;
    const requestId = request.requestId ?? randomUUID();
    const startedAt = Date.now();
    let text: string | undefined;
    try {
      const response = await openai.responses.create(
        {
          model,
          instructions: request.systemInstruction,
          input: historyToInput(request.history, request.userMessage),
          temperature: request.temperature ?? 0.2,
          max_output_tokens: request.maxOutputTokens ?? AI_CONFIG.providers.openai.maxOutputTokens,
          text: {
            format: {
              type: "json_schema",
              name: request.schemaName,
              schema: request.jsonSchema,
              strict: true,
            },
          },
        },
        { timeout: request.timeoutMs ?? AI_CONFIG.providers.openai.timeoutMs, signal: request.signal }
      );
      text = response.output_text?.trim();
      if (!text) throw new AIProviderError("OpenAI returned an empty response.", "empty_response", "openai");
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new AIProviderError("OpenAI returned invalid structured data.", "malformed_response", "openai");
      }
      const data = request.validate(parsed);
      const aiResponse: AIResponse = {
        text,
        provider: "openai",
        model,
        finishReason: response.status,
        usage: response.usage
          ? {
              inputTokens: response.usage.input_tokens,
              outputTokens: response.usage.output_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
        requestId,
        latencyMs: Date.now() - startedAt,
      };
      return { data, response: aiResponse };
    } catch (error) {
      throw toProviderError(error);
    }
  },

  async *streamText(request: GenerateTextRequest): AsyncGenerator<StreamEvent> {
    const requestId = request.requestId ?? randomUUID();
    const model = AI_CONFIG.providers.openai.model;
    const startedAt = Date.now();
    let openai: OpenAI;
    try {
      openai = getClient();
    } catch (error) {
      const providerError = toProviderError(error);
      yield { type: "error", category: providerError.category, message: providerError.message };
      return;
    }

    let stream: AsyncIterable<ResponseStreamEvent>;
    try {
      stream = await openai.responses.create(
        {
          model,
          instructions: request.systemInstruction,
          input: historyToInput(request.history, request.userMessage),
          temperature: request.temperature ?? 0.2,
          max_output_tokens: request.maxOutputTokens ?? AI_CONFIG.providers.openai.maxOutputTokens,
          stream: true,
        },
        { timeout: request.timeoutMs ?? AI_CONFIG.providers.openai.timeoutMs, signal: request.signal }
      );
    } catch (error) {
      const providerError = toProviderError(error);
      yield { type: "error", category: providerError.category, message: providerError.message };
      return;
    }

    yield { type: "start", provider: "openai", model, requestId };

    let fullText = "";
    let finishReason: string | undefined;
    try {
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          fullText += event.delta;
          yield { type: "delta", text: event.delta };
        } else if (event.type === "response.completed") {
          finishReason = event.response.status;
        } else if (event.type === "response.failed" || event.type === "response.incomplete") {
          finishReason = event.response.status;
        }
      }
    } catch (error) {
      const providerError = toProviderError(error);
      yield { type: "error", category: providerError.category, message: providerError.message };
      return;
    }

    if (!fullText.trim()) {
      yield { type: "error", category: "empty_response", message: "OpenAI returned an empty response." };
      return;
    }

    yield {
      type: "done",
      response: {
        text: fullText.trim(),
        provider: "openai",
        model,
        finishReason,
        requestId,
        latencyMs: Date.now() - startedAt,
      },
    };
  },

  async healthCheck(): Promise<HealthCheckResult> {
    if (!isProviderConfigured("openai")) {
      return { provider: "openai", healthy: false, error: "OpenAI is not configured." };
    }
    const startedAt = Date.now();
    try {
      await this.generateText({
        systemInstruction: "Reply with the single word OK.",
        userMessage: "ping",
        maxOutputTokens: 64,
        timeoutMs: 10_000,
      });
      return { provider: "openai", healthy: true, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        provider: "openai",
        healthy: false,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "Unknown error.",
      };
    }
  },
};
