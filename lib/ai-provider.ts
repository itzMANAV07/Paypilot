/**
 * lib/ai-provider.ts
 *
 * Returns a Vercel AI SDK v4 LanguageModel based on:
 *   LLM_PROVIDER — "openai" | "anthropic" | "google"
 *   LLM_MODEL    — e.g. "gpt-4o", "claude-3-5-sonnet-20241022", "gemini-2.0-flash"
 *   LLM_API_KEY  — your API key for that provider
 *
 * Usage:
 *   import { getModel } from "@/lib/ai-provider";
 *   const model = getModel();
 *
 * Server-only (env vars). Never import in client components.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

export type SupportedProvider = "openai" | "anthropic" | "google";

/** Validates LLM env vars and returns the configured model. */
export function getModel(): LanguageModel {
  const provider = process.env.LLM_PROVIDER as SupportedProvider | undefined;
  const modelName = process.env.LLM_MODEL;
  const apiKey = process.env.LLM_API_KEY;

  if (!provider) {
    throw new Error(
      "LLM_PROVIDER is not set. Set it to 'openai', 'anthropic', or 'google'."
    );
  }
  if (!modelName) {
    throw new Error(
      "LLM_MODEL is not set. Examples: 'gpt-4o', 'claude-3-5-sonnet-20241022', 'gemini-2.0-flash'."
    );
  }
  if (!apiKey) {
    throw new Error("LLM_API_KEY is not set.");
  }

  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey })(modelName);

    case "anthropic":
      return createAnthropic({ apiKey })(modelName);

    case "google":
      return createGoogleGenerativeAI({ apiKey })(modelName);

    default: {
      const _exhaustive: never = provider;
      throw new Error(
        `Unsupported LLM_PROVIDER: "${_exhaustive}". Use 'openai', 'anthropic', or 'google'.`
      );
    }
  }
}
