import type { z } from "zod";

export interface LlmRequest<T> {
  system: string;
  prompt: string;
  /** Output must be validated against this schema before it is returned. */
  schema: z.ZodType<T>;
  maxTokens?: number;
}

/**
 * Text-generation seam. Implementations return validated structured output.
 * The LLM never invents chess moves; callers validate moves against engine input.
 */
export interface LlmProvider {
  readonly name: string;
  generate<T>(request: LlmRequest<T>): Promise<T>;
}
