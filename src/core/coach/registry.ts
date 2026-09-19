import type { LlmProvider } from "./provider";
import { createAnthropicProvider } from "./anthropic";

export type CoachEnv = Readonly<Record<string, string | undefined>>;

/** Returns undefined when the provider is not configured (e.g. missing API key). */
export type ProviderFactory = (env: CoachEnv) => LlmProvider | undefined;

const factories = new Map<string, ProviderFactory>([["anthropic", createAnthropicProvider]]);

export const DEFAULT_PROVIDER = "anthropic";

/** Register an additional provider (OpenAI, local model, ...). Overwrites by name. */
export function registerProvider(name: string, factory: ProviderFactory): void {
  factories.set(name, factory);
}

export function listProviders(): string[] {
  return [...factories.keys()];
}

/**
 * Resolve the configured provider. Name comes from CHESSMIRROR_LLM_PROVIDER
 * (default "anthropic"). Returns undefined when unknown or not configured,
 * in which case callers use the template fallback.
 */
export function resolveProvider(env: CoachEnv, name?: string): LlmProvider | undefined {
  const wanted = name ?? env["CHESSMIRROR_LLM_PROVIDER"] ?? DEFAULT_PROVIDER;
  return factories.get(wanted)?.(env);
}
