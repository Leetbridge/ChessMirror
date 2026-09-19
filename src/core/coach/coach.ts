import { aliasContext } from "./alias";
import { CoachAdviceSchema, type CoachAdvice } from "./advice";
import { detectedFindings, type CoachContext } from "./context";
import { COACH_SYSTEM_PROMPT, buildCoachPrompt } from "./prompts";
import type { LlmProvider } from "./provider";
import { resolveProvider, type CoachEnv } from "./registry";
import { templateAdvice } from "./template";
import { validateAdvice } from "./validate";

export type CoachSource = "llm" | "template";

export interface CoachResult {
  advice: CoachAdvice;
  source: CoachSource;
  /** Why the template was used instead of the LLM, when it was. */
  fallbackReason?: string;
}

export interface ExplainOptions {
  /** Explicit provider (tests, custom wiring). Wins over env resolution. */
  provider?: LlmProvider;
  /** Environment for provider resolution. The app passes process.env. */
  env?: CoachEnv;
}

/**
 * Explain findings. Uses the LLM when a provider is configured and its output
 * passes schema and post-validation; otherwise returns deterministic template text.
 * Never throws because of the LLM.
 */
export async function explainFindings(ctx: CoachContext, opts: ExplainOptions = {}): Promise<CoachResult> {
  const template = (reason: string): CoachResult => ({
    advice: templateAdvice(ctx),
    source: "template",
    fallbackReason: reason,
  });

  if (detectedFindings(ctx).length === 0) return template("no detected findings");
  const provider = opts.provider ?? resolveProvider(opts.env ?? {});
  if (!provider) return template("no LLM provider configured");

  // The LLM sees opaque game aliases only; real ids are restored after validation.
  const { ctx: safe, restore } = aliasContext(ctx);
  let advice: CoachAdvice;
  try {
    advice = await provider.generate({
      system: COACH_SYSTEM_PROMPT,
      prompt: buildCoachPrompt(safe),
      schema: CoachAdviceSchema,
    });
  } catch (e) {
    return template(`provider error: ${e instanceof Error ? e.message : "unknown"}`);
  }

  const parsed = CoachAdviceSchema.safeParse(advice); // defensive: custom providers may skip validation
  if (!parsed.success) return template("provider output failed schema validation");

  const check = validateAdvice(parsed.data, safe);
  if (!check.ok) return template(`validation failed: ${check.reasons.join("; ")}`);
  return { advice: restore(parsed.data), source: "llm" };
}
