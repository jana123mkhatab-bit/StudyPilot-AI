import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * OpenAI costs money and must stay off regardless of environment state — this is the one test
 * that would fail loudly if someone ever flips OPENAI_DISABLED without meaning to keep it off.
 */
describe("isProviderConfigured (OpenAI hard off-switch)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("reports OpenAI as not configured even when OPENAI_API_KEY is set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-a-real-looking-key");
    const { isProviderConfigured } = await import("./config");
    expect(isProviderConfigured("openai")).toBe(false);
    vi.unstubAllEnvs();
  });

  it("reports Gemini as configured when GEMINI_API_KEY is set", async () => {
    vi.stubEnv("GEMINI_API_KEY", "a-key");
    const { isProviderConfigured } = await import("./config");
    expect(isProviderConfigured("gemini")).toBe(true);
    vi.unstubAllEnvs();
  });

  it("reports Gemini as not configured when GEMINI_API_KEY is unset", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const { isProviderConfigured } = await import("./config");
    expect(isProviderConfigured("gemini")).toBe(false);
    vi.unstubAllEnvs();
  });
});
