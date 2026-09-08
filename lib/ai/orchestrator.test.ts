import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AIProvider, StreamEvent } from "./types";

vi.mock("./config", () => ({
  AI_CONFIG: {
    defaultProvider: "gemini",
    fallbackProvider: "openai",
    providers: {
      gemini: { apiKey: "g", model: "gemini-test", timeoutMs: 1000, maxOutputTokens: 100 },
      openai: { apiKey: "o", model: "openai-test", timeoutMs: 1000, maxOutputTokens: 100 },
    },
  },
  isProviderConfigured: () => true,
  isAnyProviderConfigured: () => true,
}));

vi.mock("./logger", () => ({ logAIRequest: vi.fn() }));

function makeProvider(name: "gemini" | "openai"): AIProvider {
  return {
    name,
    isConfigured: vi.fn(() => true),
    generateText: vi.fn(),
    generateStructured: vi.fn(),
    streamText: vi.fn(),
    healthCheck: vi.fn(),
  };
}

const geminiMock = makeProvider("gemini");
const openaiMock = makeProvider("openai");

vi.mock("./providers/gemini-provider", () => ({ geminiProvider: geminiMock }));
vi.mock("./providers/openai-provider", () => ({ openaiProvider: openaiMock }));

const { aiOrchestrator } = await import("./orchestrator");
const { AIProviderError, AIConfigError } = await import("./types");

beforeEach(() => {
  vi.clearAllMocks();
  (geminiMock.isConfigured as ReturnType<typeof vi.fn>).mockReturnValue(true);
  (openaiMock.isConfigured as ReturnType<typeof vi.fn>).mockReturnValue(true);
});

describe("aiOrchestrator.generateText", () => {
  it("returns the primary provider's response on success without touching the fallback", async () => {
    (geminiMock.generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "hi",
      provider: "gemini",
      model: "gemini-test",
      requestId: "r1",
      latencyMs: 10,
    });

    const result = await aiOrchestrator.generateText({ systemInstruction: "s", userMessage: "u" }, { taskType: "tutor_chat" });

    expect(result.text).toBe("hi");
    expect(openaiMock.generateText).not.toHaveBeenCalled();
  });

  it("falls back to the configured fallback provider on a retryable failure", async () => {
    (geminiMock.generateText as ReturnType<typeof vi.fn>).mockRejectedValue(new AIProviderError("boom", "timeout", "gemini"));
    (openaiMock.generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "fallback answer",
      provider: "openai",
      model: "openai-test",
      requestId: "r2",
      latencyMs: 20,
    });

    const result = await aiOrchestrator.generateText({ systemInstruction: "s", userMessage: "u" }, { taskType: "tutor_chat" });

    expect(result.text).toBe("fallback answer");
    expect(openaiMock.generateText).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-retryable failure and rethrows it unchanged", async () => {
    (geminiMock.generateText as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AIProviderError("bad request", "malformed_response", "gemini")
    );

    await expect(
      aiOrchestrator.generateText({ systemInstruction: "s", userMessage: "u" }, { taskType: "tutor_chat" })
    ).rejects.toThrow("bad request");
    expect(openaiMock.generateText).not.toHaveBeenCalled();
  });

  it("falls back when the default provider is not configured at all", async () => {
    (geminiMock.isConfigured as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (openaiMock.generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "openai picked up the slack",
      provider: "openai",
      model: "openai-test",
      requestId: "r3",
      latencyMs: 15,
    });

    const result = await aiOrchestrator.generateText({ systemInstruction: "s", userMessage: "u" }, { taskType: "tutor_chat" });

    expect(result.text).toBe("openai picked up the slack");
    expect(geminiMock.generateText).not.toHaveBeenCalled();
  });

  it("throws when nothing is configured", async () => {
    (geminiMock.isConfigured as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (openaiMock.isConfigured as ReturnType<typeof vi.fn>).mockReturnValue(false);

    await expect(
      aiOrchestrator.generateText({ systemInstruction: "s", userMessage: "u" }, { taskType: "tutor_chat" })
    ).rejects.toThrow(AIConfigError);
  });
});

describe("aiOrchestrator.streamText", () => {
  it("falls back to the secondary provider when the primary errors before any delta", async () => {
    async function* geminiStream(): AsyncGenerator<StreamEvent> {
      yield { type: "start", provider: "gemini", model: "gemini-test", requestId: "r1" };
      yield { type: "error", category: "unavailable", message: "down" };
    }
    async function* openaiStream(): AsyncGenerator<StreamEvent> {
      yield { type: "start", provider: "openai", model: "openai-test", requestId: "r2" };
      yield { type: "delta", text: "hello" };
      yield { type: "done", response: { text: "hello", provider: "openai", model: "openai-test", requestId: "r2", latencyMs: 5 } };
    }
    (geminiMock.streamText as ReturnType<typeof vi.fn>).mockReturnValue(geminiStream());
    (openaiMock.streamText as ReturnType<typeof vi.fn>).mockReturnValue(openaiStream());

    const events: StreamEvent[] = [];
    for await (const event of aiOrchestrator.streamText({ systemInstruction: "s", userMessage: "u" }, { taskType: "tutor_chat" })) {
      events.push(event);
    }

    expect(events.some((e) => e.type === "delta" && e.text === "hello")).toBe(true);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("does not fall back once a delta has already reached the client", async () => {
    async function* geminiStream(): AsyncGenerator<StreamEvent> {
      yield { type: "start", provider: "gemini", model: "gemini-test", requestId: "r1" };
      yield { type: "delta", text: "partial" };
      yield { type: "error", category: "unavailable", message: "dropped mid-stream" };
    }
    (geminiMock.streamText as ReturnType<typeof vi.fn>).mockReturnValue(geminiStream());

    const events: StreamEvent[] = [];
    for await (const event of aiOrchestrator.streamText({ systemInstruction: "s", userMessage: "u" }, { taskType: "tutor_chat" })) {
      events.push(event);
    }

    expect(openaiMock.streamText).not.toHaveBeenCalled();
    expect(events.at(-1)?.type).toBe("error");
  });
});
