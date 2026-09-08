import "server-only";
import { randomUUID } from "node:crypto";
import { AI_CONFIG } from "./config";
import { logAIRequest } from "./logger";
import { geminiProvider } from "./providers/gemini-provider";
import { openaiProvider } from "./providers/openai-provider";
import {
  AIConfigError,
  AIProviderError,
  isRetryableCategory,
  type AIProvider,
  type AIProviderName,
  type AIResponse,
  type AITaskType,
  type GenerateStructuredRequest,
  type GenerateTextRequest,
  type HealthCheckResult,
  type StreamEvent,
} from "./types";

const PROVIDERS: Record<AIProviderName, AIProvider> = {
  gemini: geminiProvider,
  openai: openaiProvider,
};

export interface OrchestratorMeta {
  taskType: AITaskType;
  provider?: AIProviderName;
  userId?: string;
  courseId?: string;
}

function resolveProvider(name: AIProviderName | undefined): { provider: AIProvider; name: AIProviderName } {
  const resolved = name ?? AI_CONFIG.defaultProvider;
  const provider = PROVIDERS[resolved];
  if (!provider.isConfigured()) {
    throw new AIConfigError(`${resolved} is not configured.`, resolved);
  }
  return { provider, name: resolved };
}

function resolveFallback(primary: AIProviderName): { provider: AIProvider; name: AIProviderName } | null {
  const fallbackName = AI_CONFIG.fallbackProvider;
  if (!fallbackName || fallbackName === primary) return null;
  const provider = PROVIDERS[fallbackName];
  if (!provider.isConfigured()) return null;
  return { provider, name: fallbackName };
}

export function isAIAvailable(): boolean {
  return geminiProvider.isConfigured() || openaiProvider.isConfigured();
}

class AIOrchestrator {
  async generateText(request: GenerateTextRequest, meta: OrchestratorMeta): Promise<AIResponse> {
    const requestId = request.requestId ?? randomUUID();
    const name = meta.provider ?? AI_CONFIG.defaultProvider;
    try {
      const { provider } = resolveProvider(meta.provider);
      const response = await provider.generateText({ ...request, requestId });
      logAIRequest({
        requestId,
        taskType: meta.taskType,
        provider: name,
        model: response.model,
        latencyMs: response.latencyMs,
        success: true,
        usage: response.usage,
        userId: meta.userId,
        courseId: meta.courseId,
      });
      return response;
    } catch (error) {
      return this.retryWithFallback(error, name, meta, requestId, (fallback) =>
        fallback.generateText({ ...request, requestId })
      );
    }
  }

  async generateStructured<T>(
    request: GenerateStructuredRequest<T>,
    meta: OrchestratorMeta
  ): Promise<{ data: T; response: AIResponse }> {
    const requestId = request.requestId ?? randomUUID();
    const name = meta.provider ?? AI_CONFIG.defaultProvider;
    try {
      const { provider } = resolveProvider(meta.provider);
      const result = await provider.generateStructured({ ...request, requestId });
      logAIRequest({
        requestId,
        taskType: meta.taskType,
        provider: name,
        model: result.response.model,
        latencyMs: result.response.latencyMs,
        success: true,
        usage: result.response.usage,
        userId: meta.userId,
        courseId: meta.courseId,
      });
      return result;
    } catch (error) {
      return this.retryWithFallback(error, name, meta, requestId, (fallback) =>
        fallback.generateStructured({ ...request, requestId })
      );
    }
  }

  private async retryWithFallback<T>(
    error: unknown,
    primaryName: AIProviderName,
    meta: OrchestratorMeta,
    requestId: string,
    run: (fallback: AIProvider) => Promise<T>
  ): Promise<T> {
    const category = error instanceof AIProviderError ? error.category : "unknown";
    logAIRequest({
      requestId,
      taskType: meta.taskType,
      provider: primaryName,
      model: AI_CONFIG.providers[primaryName].model,
      latencyMs: 0,
      success: false,
      errorCategory: category,
      userId: meta.userId,
      courseId: meta.courseId,
    });

    // "not_configured" always gets a shot at a fallback (switching provider fixes it by definition,
    // unlike a generic retryable failure); resolveFallback already confirms the fallback itself works.
    const canFallback = isRetryableCategory(category) || category === "not_configured";
    const fallback = canFallback ? resolveFallback(primaryName) : null;
    if (!fallback) {
      if (error instanceof AIProviderError || error instanceof Error) throw error;
      throw new AIProviderError("The AI provider is temporarily unavailable.", "unknown", primaryName);
    }

    try {
      const result = await run(fallback.provider);
      const response = (result as { response?: AIResponse }).response ?? (result as unknown as AIResponse);
      logAIRequest({
        requestId,
        taskType: meta.taskType,
        provider: fallback.name,
        model: response.model,
        latencyMs: response.latencyMs,
        success: true,
        usage: response.usage,
        userId: meta.userId,
        courseId: meta.courseId,
        fallbackFrom: primaryName,
      });
      return result;
    } catch (fallbackError) {
      const fallbackCategory = fallbackError instanceof AIProviderError ? fallbackError.category : "unknown";
      logAIRequest({
        requestId,
        taskType: meta.taskType,
        provider: fallback.name,
        model: AI_CONFIG.providers[fallback.name].model,
        latencyMs: 0,
        success: false,
        errorCategory: fallbackCategory,
        userId: meta.userId,
        courseId: meta.courseId,
        fallbackFrom: primaryName,
      });
      throw fallbackError;
    }
  }

  /**
   * No mid-stream fallback: once the first delta reaches the client, switching providers would
   * either duplicate or discard visible text. Fallback only covers a failure before any output.
   */
  async *streamText(request: GenerateTextRequest, meta: OrchestratorMeta): AsyncGenerator<StreamEvent> {
    const requestId = request.requestId ?? randomUUID();
    const intendedName = meta.provider ?? AI_CONFIG.defaultProvider;
    let currentProvider: AIProvider;
    let currentName: AIProviderName;
    let startedFallback = false;
    try {
      ({ provider: currentProvider, name: currentName } = resolveProvider(meta.provider));
    } catch (error) {
      logAIRequest({
        requestId,
        taskType: meta.taskType,
        provider: intendedName,
        model: "unknown",
        latencyMs: 0,
        success: false,
        errorCategory: "not_configured",
        userId: meta.userId,
        courseId: meta.courseId,
      });
      const fallback = resolveFallback(intendedName);
      if (!fallback) {
        const message = error instanceof Error ? error.message : "AI provider is not configured.";
        yield { type: "error", category: "not_configured", message };
        return;
      }
      startedFallback = true;
      currentProvider = fallback.provider;
      currentName = fallback.name;
    }

    let emittedDelta = false;
    const startedAt = Date.now();

    while (true) {
      let sawError = false;
      let errorEvent: Extract<StreamEvent, { type: "error" }> | undefined;
      for await (const event of currentProvider.streamText({ ...request, requestId })) {
        if (event.type === "delta") emittedDelta = true;
        if (event.type === "error") {
          sawError = true;
          errorEvent = event;
          break;
        }
        yield event;
        if (event.type === "done") {
          logAIRequest({
            requestId,
            taskType: meta.taskType,
            provider: currentName,
            model: event.response.model,
            latencyMs: event.response.latencyMs,
            success: true,
            userId: meta.userId,
            courseId: meta.courseId,
            fallbackFrom: startedFallback ? intendedName : undefined,
          });
          return;
        }
      }

      if (!sawError || !errorEvent) return;

      logAIRequest({
        requestId,
        taskType: meta.taskType,
        provider: currentName,
        model: AI_CONFIG.providers[currentName].model,
        latencyMs: Date.now() - startedAt,
        success: false,
        errorCategory: errorEvent.category,
        userId: meta.userId,
        courseId: meta.courseId,
      });

      const canFallback = !emittedDelta && !startedFallback && isRetryableCategory(errorEvent.category);
      const fallback = canFallback ? resolveFallback(currentName) : null;
      if (!fallback) {
        yield errorEvent;
        return;
      }
      startedFallback = true;
      currentName = fallback.name;
      currentProvider = fallback.provider;
    }
  }

  async healthCheck(name: AIProviderName): Promise<HealthCheckResult> {
    return PROVIDERS[name].healthCheck();
  }

  async healthCheckAll(): Promise<HealthCheckResult[]> {
    return Promise.all([this.healthCheck("gemini"), this.healthCheck("openai")]);
  }
}

export const aiOrchestrator = new AIOrchestrator();
