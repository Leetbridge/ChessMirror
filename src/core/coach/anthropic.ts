import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { CoachEnv } from "./registry";
import { LlmError, type LlmProvider, type LlmRequest } from "./provider";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";
/** Per-request timeout in ms (SDK ClientOptions.timeout is in milliseconds). */
export const REQUEST_TIMEOUT_MS = 60_000;
export const MAX_RETRIES = 2;

/** The subset of the SDK client we use; injectable for tests. */
export interface AnthropicLike {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

export interface AnthropicProviderOptions {
  client: AnthropicLike;
  model?: string;
}

/**
 * Structured-output JSON Schema does not support every JSON Schema keyword
 * (length/range/pattern constraints). Strip them from the wire schema; the
 * zod schema still enforces them on the parsed result.
 */
const UNSUPPORTED_KEYS = new Set([
  "minLength", "maxLength", "pattern", "minimum", "maximum", "exclusiveMinimum",
  "exclusiveMaximum", "multipleOf", "minItems", "maxItems", "uniqueItems", "format", "$schema",
]);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (!UNSUPPORTED_KEYS.has(k)) out[k] = strip(v);
    }
    return out;
  }
  return node;
}

export function toWireSchema(schema: z.ZodType): Record<string, unknown> {
  return strip(z.toJSONSchema(schema, { io: "output" })) as Record<string, unknown>;
}

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  private readonly client: AnthropicLike;
  private readonly model: string;

  constructor(opts: AnthropicProviderOptions) {
    this.client = opts.client;
    this.model = opts.model ?? DEFAULT_ANTHROPIC_MODEL;
  }

  async generate<T>(request: LlmRequest<T>): Promise<T> {
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens ?? 8000,
        system: request.system,
        messages: [{ role: "user", content: request.prompt }],
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: toWireSchema(request.schema) },
        },
      });
    } catch (e) {
      throw new LlmError(e instanceof Error ? e.message : "Anthropic request failed", "api");
    }

    if (message.stop_reason === "refusal") throw new LlmError("Model refused the request", "refusal");
    if (message.stop_reason === "max_tokens") throw new LlmError("Output truncated (max_tokens)", "truncated");

    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new LlmError("Output is not valid JSON", "invalid_output");
    }
    const parsed = request.schema.safeParse(json);
    if (!parsed.success) {
      throw new LlmError(`Output failed schema validation: ${parsed.error.message}`, "invalid_output");
    }
    return parsed.data;
  }
}

/** Registry factory. Key and model come from env only; never hardcoded. */
export function createAnthropicProvider(env: CoachEnv): LlmProvider | undefined {
  const apiKey = env["ANTHROPIC_API_KEY"];
  if (!apiKey) return undefined;
  const model = env["ANTHROPIC_MODEL"] || DEFAULT_ANTHROPIC_MODEL;
  return new AnthropicProvider({ client: new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: MAX_RETRIES }), model });
}
