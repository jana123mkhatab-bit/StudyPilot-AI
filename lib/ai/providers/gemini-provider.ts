import "server-only";
import { randomUUID } from "node:crypto";
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

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

function historyToContents(history: ChatTurn[] | undefined, userMessage: string) {
  const contents = (history ?? []).map((turn) => ({
    role: turn.role === "assistant" ? "model" : "user",
    parts: [{ text: turn.content }],
  }));
  contents.push({ role: "user", parts: [{ text: userMessage }] });
  return contents;
}

/**
 * Gemini's responseSchema is a restricted OpenAPI 3.0 subset — unlike OpenAI's Structured
 * Outputs, it rejects unknown keywords such as `additionalProperties` with an HTTP 400 rather
 * than ignoring them. Strip the keywords our schemas.ts definitions include for OpenAI's benefit.
 */
export function sanitizeSchemaForGemini(schema: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = { ...schema };
  delete sanitized.additionalProperties;
  if (sanitized.properties && typeof sanitized.properties === "object") {
    sanitized.properties = Object.fromEntries(
      Object.entries(sanitized.properties as Record<string, unknown>).map(([key, value]) => [
        key,
        typeof value === "object" && value !== null ? sanitizeSchemaForGemini(value as Record<string, unknown>) : value,
      ])
    );
  }
  if (sanitized.items && typeof sanitized.items === "object") {
    sanitized.items = sanitizeSchemaForGemini(sanitized.items as Record<string, unknown>);
  }
  return sanitized;
}

function categorizeFetchError(error: unknown, status?: number): AIErrorCategory {
  if (error instanceof DOMException && error.name === "AbortError") return "timeout";
  if (status === 401 || status === 403) return "invalid_api_key";
  if (status === 429) return "rate_limit";
  if (status && status >= 500) return "unavailable";
  if (error instanceof TypeError) return "network";
  return "unknown";
}

async function callGemini(
  request: GenerateTextRequest,
  extra: { responseMimeType?: string; responseSchema?: Record<string, unknown> } = {}
): Promise<{ text: string; response: AIResponse }> {
  const apiKey = AI_CONFIG.providers.gemini.apiKey;
  if (!apiKey) throw new AIConfigError("Gemini is not configured.", "gemini");

  const model = AI_CONFIG.providers.gemini.model;
  const requestId = request.requestId ?? randomUUID();
  const controller = new AbortController();
  const timeoutMs = request.timeoutMs ?? AI_CONFIG.providers.gemini.timeoutMs;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  request.signal?.addEventListener("abort", () => controller.abort());
  const startedAt = Date.now();

  try {
    const response = await fetch(
      `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.systemInstruction }] },
          contents: historyToContents(request.history, request.userMessage),
          generationConfig: {
            temperature: request.temperature ?? 0.2,
            maxOutputTokens: request.maxOutputTokens ?? AI_CONFIG.providers.gemini.maxOutputTokens,
            ...(extra.responseMimeType ? { responseMimeType: extra.responseMimeType } : {}),
            ...(extra.responseSchema ? { responseSchema: extra.responseSchema } : {}),
          },
        }),
        signal: controller.signal,
      }
    );
    if (!response.ok) {
      const category = categorizeFetchError(undefined, response.status);
      throw new AIProviderError(`Gemini request failed (${response.status}).`, category, "gemini");
    }
    const payload = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
    };
    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();
    if (!text) throw new AIProviderError("Gemini returned an empty response.", "empty_response", "gemini");
    return {
      text,
      response: {
        text,
        provider: "gemini",
        model,
        finishReason: payload.candidates?.[0]?.finishReason,
        usage: payload.usageMetadata
          ? {
              inputTokens: payload.usageMetadata.promptTokenCount,
              outputTokens: payload.usageMetadata.candidatesTokenCount,
              totalTokens: payload.usageMetadata.totalTokenCount,
            }
          : undefined,
        requestId,
        latencyMs: Date.now() - startedAt,
      },
    };
  } catch (error) {
    if (error instanceof AIProviderError) throw error;
    const category = categorizeFetchError(error);
    throw new AIProviderError(
      category === "timeout" ? "Gemini timed out. Please try again." : "Gemini could not be reached.",
      category,
      "gemini"
    );
  } finally {
    clearTimeout(timeout);
  }
}

export const geminiProvider: AIProvider = {
  name: "gemini",

  isConfigured() {
    return isProviderConfigured("gemini");
  },

  async generateText(request) {
    const { response } = await callGemini(request);
    return response;
  },

  async generateStructured<T>(request: GenerateStructuredRequest<T>) {
    const { text, response } = await callGemini(request, {
      responseMimeType: "application/json",
      responseSchema: sanitizeSchemaForGemini(request.jsonSchema),
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    } catch {
      throw new AIProviderError("Gemini returned invalid structured data.", "malformed_response", "gemini");
    }
    const data = request.validate(parsed);
    return { data, response: { ...response, text: JSON.stringify(parsed) } };
  },

  async *streamText(request: GenerateTextRequest): AsyncGenerator<StreamEvent> {
    const apiKey = AI_CONFIG.providers.gemini.apiKey;
    if (!apiKey) throw new AIConfigError("Gemini is not configured.", "gemini");
    const model = AI_CONFIG.providers.gemini.model;
    const requestId = request.requestId ?? randomUUID();
    const controller = new AbortController();
    const timeoutMs = request.timeoutMs ?? AI_CONFIG.providers.gemini.timeoutMs;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    request.signal?.addEventListener("abort", () => controller.abort());
    const startedAt = Date.now();

    try {
      const response = await fetch(
        `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: request.systemInstruction }] },
            contents: historyToContents(request.history, request.userMessage),
            generationConfig: {
              temperature: request.temperature ?? 0.2,
              maxOutputTokens: request.maxOutputTokens ?? AI_CONFIG.providers.gemini.maxOutputTokens,
            },
          }),
          signal: controller.signal,
        }
      );
      if (!response.ok || !response.body) {
        const category = categorizeFetchError(undefined, response.status);
        throw new AIProviderError(`Gemini request failed (${response.status}).`, category, "gemini");
      }

      yield { type: "start", provider: "gemini", model, requestId };

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      let finishReason: string | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Gemini's SSE frames are delimited by "\r\n\r\n", not "\n\n" — normalize before splitting.
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
          if (!dataLine) continue;
          const jsonText = dataLine.slice(5).trim();
          if (!jsonText) continue;
          try {
            const chunk = JSON.parse(jsonText) as {
              candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
            };
            const delta = chunk.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") ?? "";
            finishReason = chunk.candidates?.[0]?.finishReason ?? finishReason;
            if (delta) {
              fullText += delta;
              yield { type: "delta", text: delta };
            }
          } catch {
            // Ignore malformed keep-alive/partial frames; the stream self-corrects on the next chunk.
          }
        }
      }

      if (!fullText.trim()) {
        yield { type: "error", category: "empty_response", message: "Gemini returned an empty response." };
        return;
      }

      yield {
        type: "done",
        response: {
          text: fullText.trim(),
          provider: "gemini",
          model,
          finishReason,
          requestId,
          latencyMs: Date.now() - startedAt,
        },
      };
    } catch (error) {
      if (error instanceof AIProviderError) {
        yield { type: "error", category: error.category, message: error.message };
        return;
      }
      const category = categorizeFetchError(error);
      yield {
        type: "error",
        category,
        message: category === "timeout" ? "Gemini timed out. Please try again." : "Gemini could not be reached.",
      };
    } finally {
      clearTimeout(timeout);
    }
  },

  async healthCheck(): Promise<HealthCheckResult> {
    if (!isProviderConfigured("gemini")) {
      return { provider: "gemini", healthy: false, error: "Gemini is not configured." };
    }
    const startedAt = Date.now();
    try {
      await callGemini({
        systemInstruction: "Reply with the single word OK.",
        userMessage: "ping",
        maxOutputTokens: 16,
        timeoutMs: 10_000,
      });
      return { provider: "gemini", healthy: true, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        provider: "gemini",
        healthy: false,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "Unknown error.",
      };
    }
  },
};
