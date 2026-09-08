import "server-only";
import type { AIProviderName } from "./types";

function parseProviderName(value: string | undefined): AIProviderName | undefined {
  return value === "openai" || value === "gemini" ? value : undefined;
}

export const AI_CONFIG = {
  defaultProvider: parseProviderName(process.env.AI_PROVIDER?.trim()) ?? "gemini",
  /** Unset by default — a request only retries on a second provider when this is explicitly configured. */
  fallbackProvider: parseProviderName(process.env.AI_FALLBACK_PROVIDER?.trim()),
  providers: {
    gemini: {
      apiKey: process.env.GEMINI_API_KEY?.trim() || "",
      model: process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash",
      timeoutMs: 45_000,
      maxOutputTokens: 2_000,
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY?.trim() || "",
      model: process.env.OPENAI_MODEL?.trim() || "gpt-5-mini",
      timeoutMs: 45_000,
      maxOutputTokens: 2_000,
    },
  },
} as const;

/**
 * Hard off-switch: the OpenAI API costs money, so it's disabled here regardless of whether
 * OPENAI_API_KEY is set — every call site already gates on isProviderConfigured() before ever
 * touching the network, so this one flag is enough to guarantee no OpenAI request can fire.
 * To re-enable: flip this to false and put a real key in OPENAI_API_KEY.
 */
const OPENAI_DISABLED = true;

export function isProviderConfigured(provider: AIProviderName): boolean {
  if (provider === "openai" && OPENAI_DISABLED) return false;
  return Boolean(AI_CONFIG.providers[provider].apiKey);
}

export function isAnyProviderConfigured(): boolean {
  return isProviderConfigured("gemini") || isProviderConfigured("openai");
}
